#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <EEPROM.h>
#include <NTPClient.h>
#include <WiFiUdp.h>

/* ================= CONFIGURAÇÕES ================= */

// Nome da rede WiFi criada pelo ESP32
#define WIFI_SSID "BOMBA DAGUA"
#define WIFI_PASS "152547"

// Pino da bomba (relé) - usar pino 26 como no seu código
#define BOMBA_PIN 26

// IP personalizado do Access Point
IPAddress local_ip(192, 168, 10, 1);
IPAddress gateway(192, 168, 10, 1);
IPAddress subnet(255, 255, 255, 0);

// Endereços EEPROM
#define EEPROM_SIZE 512
#define EEPROM_ADDR_STATE 0
#define EEPROM_ADDR_TOTAL_HOJE 10
#define EEPROM_ADDR_TOTAL_MES 20
#define EEPROM_ADDR_SESSOES_HOJE 30
#define EEPROM_ADDR_SESSOES_MES 40
#define EEPROM_ADDR_HISTORICO 100

// Servidor Web na porta 80
WebServer server(80);

// Cliente NTP para sincronizar hora
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", -3 * 3600, 60000); // GMT-3 (Brasília)

/* ================= VARIÁVEIS GLOBAIS ================= */

// Estado da bomba
bool bombaLigada = false;
unsigned long bombaLigadaTimestamp = 0; // Quando a bomba foi ligada (epoch time)
unsigned long bombaLigadaMillis = 0;    // Quando a bomba foi ligada (millis)

// Estatísticas
struct Estatisticas {
  unsigned long totalHoje;      // Segundos hoje
  unsigned long totalMes;       // Segundos este mês
  unsigned int sessoesHoje;     // Quantas vezes ligou hoje
  unsigned int sessoesMes;      // Quantas vezes ligou este mês
  unsigned long ultimaReset;    // Quando foi o último reset (dia)
};

Estatisticas stats;

// Histórico de operações
struct HistoricoItem {
  unsigned long timestamp;  // Epoch time
  bool acao;               // true = ligou, false = desligou
  unsigned long duracao;   // Segundos (apenas para desligar)
};

#define MAX_HISTORICO 50
HistoricoItem historico[MAX_HISTORICO];
int historicoIndex = 0;
int historicoCount = 0;

// Buffer para JSON
StaticJsonDocument<4096> jsonDoc;

/* ================= FUNÇÕES EEPROM ================= */

void salvarEstado() {
  EEPROM.write(EEPROM_ADDR_STATE, bombaLigada ? 1 : 0);
  
  // Salvar estatísticas
  EEPROM.writeULong(EEPROM_ADDR_TOTAL_HOJE, stats.totalHoje);
  EEPROM.writeULong(EEPROM_ADDR_TOTAL_MES, stats.totalMes);
  EEPROM.writeUShort(EEPROM_ADDR_SESSOES_HOJE, stats.sessoesHoje);
  EEPROM.writeUShort(EEPROM_ADDR_SESSOES_MES, stats.sessoesMes);
  
  EEPROM.commit();
  Serial.println("Estado salvo na EEPROM");
}

void carregarEstado() {
  bombaLigada = EEPROM.read(EEPROM_ADDR_STATE) == 1;
  
  // Carregar estatísticas
  stats.totalHoje = EEPROM.readULong(EEPROM_ADDR_TOTAL_HOJE);
  stats.totalMes = EEPROM.readULong(EEPROM_ADDR_TOTAL_MES);
  stats.sessoesHoje = EEPROM.readUShort(EEPROM_ADDR_SESSOES_HOJE);
  stats.sessoesMes = EEPROM.readUShort(EEPROM_ADDR_SESSOES_MES);
  stats.ultimaReset = 0; // Será atualizado ao verificar data
  
  Serial.println("Estado carregado da EEPROM");
  
  // Se a bomba estava ligada, ligar agora
  if (bombaLigada) {
    digitalWrite(BOMBA_PIN, HIGH);
    bombaLigadaMillis = millis();
    // Timestamp será atualizado quando NTP sincronizar
  } else {
    digitalWrite(BOMBA_PIN, LOW);
  }
}

void resetEstatisticasDiarias() {
  unsigned long now = timeClient.getEpochTime();
  struct tm *timeinfo = localtime((const time_t*)&now);
  int diaAtual = timeinfo->tm_mday;
  
  // Se for um novo dia, resetar estatísticas diárias
  if (stats.ultimaReset != diaAtual) {
    stats.totalHoje = 0;
    stats.sessoesHoje = 0;
    stats.ultimaReset = diaAtual;
    salvarEstado();
    Serial.println("Estatísticas diárias resetadas (novo dia)");
  }
}

/* ================= FUNÇÕES BOMBA ================= */

void ligarBomba() {
  if (!bombaLigada) {
    digitalWrite(BOMBA_PIN, HIGH);
    bombaLigada = true;
    bombaLigadaMillis = millis();
    bombaLigadaTimestamp = timeClient.getEpochTime();
    
    // Registrar no histórico
    if (historicoCount < MAX_HISTORICO) {
      historico[historicoIndex].timestamp = bombaLigadaTimestamp;
      historico[historicoIndex].acao = true;
      historico[historicoIndex].duracao = 0;
      historicoIndex = (historicoIndex + 1) % MAX_HISTORICO;
      if (historicoCount < MAX_HISTORICO) historicoCount++;
    }
    
    // Atualizar estatísticas
    stats.sessoesHoje++;
    stats.sessoesMes++;
    
    salvarEstado();
    
    Serial.println("Bomba LIGADA");
  }
}

void desligarBomba() {
  if (bombaLigada) {
    digitalWrite(BOMBA_PIN, LOW);
    bombaLigada = false;
    
    // Calcular duração
    unsigned long duracaoMillis = millis() - bombaLigadaMillis;
    unsigned long duracaoSegundos = duracaoMillis / 1000;
    
    // Atualizar estatísticas
    stats.totalHoje += duracaoSegundos;
    stats.totalMes += duracaoSegundos;
    
    // Atualizar último item do histórico (que foi o ligar)
    int lastIndex = (historicoIndex - 1 + MAX_HISTORICO) % MAX_HISTORICO;
    if (historicoCount > 0 && historico[lastIndex].acao) {
      historico[lastIndex].duracao = duracaoSegundos;
    }
    
    // Registrar desligamento no histórico
    if (historicoCount < MAX_HISTORICO) {
      historico[historicoIndex].timestamp = timeClient.getEpochTime();
      historico[historicoIndex].acao = false;
      historico[historicoIndex].duracao = 0;
      historicoIndex = (historicoIndex + 1) % MAX_HISTORICO;
      if (historicoCount < MAX_HISTORICO) historicoCount++;
    }
    
    salvarEstado();
    
    Serial.printf("Bomba DESLIGADA - Duração: %lu segundos\n", duracaoSegundos);
  }
}

/* ================= FUNÇÕES API REST ================= */

void apiStatus() {
  jsonDoc.clear();
  jsonDoc["status"] = "success";
  jsonDoc["bomba"] = bombaLigada ? "ligada" : "desligada";
  jsonDoc["timestamp"] = timeClient.getEpochTime();
  
  if (bombaLigada) {
    unsigned long tempoAtual = (millis() - bombaLigadaMillis) / 1000;
    jsonDoc["tempo_atual"] = tempoAtual;
    jsonDoc["tempo_formatado"] = formatTime(tempoAtual);
    jsonDoc["ligada_desde"] = bombaLigadaTimestamp;
  }
  
  String response;
  serializeJson(jsonDoc, response);
  server.send(200, "application/json", response);
}

void apiLigar() {
  ligarBomba();
  
  jsonDoc.clear();
  jsonDoc["status"] = "success";
  jsonDoc["message"] = "Bomba ligada com sucesso";
  jsonDoc["bomba"] = "ligada";
  jsonDoc["timestamp"] = timeClient.getEpochTime();
  
  String response;
  serializeJson(jsonDoc, response);
  server.send(200, "application/json", response);
}

void apiDesligar() {
  desligarBomba();
  
  jsonDoc.clear();
  jsonDoc["status"] = "success";
  jsonDoc["message"] = "Bomba desligada com sucesso";
  jsonDoc["bomba"] = "desligada";
  jsonDoc["timestamp"] = timeClient.getEpochTime();
  
  String response;
  serializeJson(jsonDoc, response);
  server.send(200, "application/json", response);
}

void apiAlternar() {
  if (bombaLigada) {
    desligarBomba();
  } else {
    ligarBomba();
  }
  
  jsonDoc.clear();
  jsonDoc["status"] = "success";
  jsonDoc["message"] = bombaLigada ? "Bomba ligada" : "Bomba desligada";
  jsonDoc["bomba"] = bombaLigada ? "ligada" : "desligada";
  jsonDoc["timestamp"] = timeClient.getEpochTime();
  
  String response;
  serializeJson(jsonDoc, response);
  server.send(200, "application/json", response);
}

void apiEstatisticas() {
  jsonDoc.clear();
  jsonDoc["status"] = "success";
  
  JsonObject estatisticas = jsonDoc.createNestedObject("estatisticas");
  estatisticas["total_hoje"] = stats.totalHoje;
  estatisticas["total_mes"] = stats.totalMes;
  estatisticas["sessoes_hoje"] = stats.sessoesHoje;
  estatisticas["sessoes_mes"] = stats.sessoesMes;
  
  estatisticas["hoje_formatado"] = formatTime(stats.totalHoje);
  estatisticas["mes_formatado"] = formatTime(stats.totalMes);
  
  // Tempo atual se a bomba estiver ligada
  if (bombaLigada) {
    unsigned long tempoAtual = (millis() - bombaLigadaMillis) / 1000;
    estatisticas["tempo_atual"] = tempoAtual;
    estatisticas["tempo_atual_formatado"] = formatTime(tempoAtual);
  }
  
  String response;
  serializeJson(jsonDoc, response);
  server.send(200, "application/json", response);
}

void apiHistorico() {
  jsonDoc.clear();
  jsonDoc["status"] = "success";
  jsonDoc["count"] = historicoCount;
  
  JsonArray historicoArray = jsonDoc.createNestedArray("historico");
  
  // Começar do mais recente
  int idx = (historicoIndex - 1 + MAX_HISTORICO) % MAX_HISTORICO;
  
  for (int i = 0; i < historicoCount && i < 20; i++) { // Limitar a 20 registros
    JsonObject item = historicoArray.createNestedObject();
    item["timestamp"] = historico[idx].timestamp;
    item["acao"] = historico[idx].acao ? "ligar" : "desligar";
    item["duracao"] = historico[idx].duracao;
    
    // Formatar data/hora
    time_t rawtime = historico[idx].timestamp;
    struct tm *timeinfo = localtime(&rawtime);
    char buffer[30];
    strftime(buffer, 30, "%d/%m/%Y %H:%M:%S", timeinfo);
    item["data_hora"] = String(buffer);
    
    // Formatar duração
    if (historico[idx].duracao > 0) {
      item["duracao_formatada"] = formatTime(historico[idx].duracao);
    }
    
    idx = (idx - 1 + MAX_HISTORICO) % MAX_HISTORICO;
  }
  
  String response;
  serializeJson(jsonDoc, response);
  server.send(200, "application/json", response);
}

void apiDataHora() {
  jsonDoc.clear();
  jsonDoc["status"] = "success";
  jsonDoc["timestamp"] = timeClient.getEpochTime();
  jsonDoc["formatted_time"] = timeClient.getFormattedTime();
  
  // Data completa em português
  time_t rawtime = timeClient.getEpochTime();
  struct tm *timeinfo = localtime(&rawtime);
  char buffer[50];
  strftime(buffer, 50, "%A, %d de %B de %Y %H:%M:%S", timeinfo);
  jsonDoc["full_date"] = String(buffer);
  
  // Dia da semana
  char dias[7][15] = {"Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", 
                      "Quinta-feira", "Sexta-feira", "Sábado"};
  jsonDoc["weekday"] = dias[timeinfo->tm_wday];
  
  String response;
  serializeJson(jsonDoc, response);
  server.send(200, "application/json", response);
}

void apiReset() {
  String tipo = server.arg("tipo");
  
  jsonDoc.clear();
  
  if (tipo == "hoje") {
    stats.totalHoje = 0;
    stats.sessoesHoje = 0;
    jsonDoc["message"] = "Estatísticas de hoje resetadas";
  } else if (tipo == "mes") {
    stats.totalMes = 0;
    stats.sessoesMes = 0;
    jsonDoc["message"] = "Estatísticas do mês resetadas";
  } else if (tipo == "tudo") {
    stats.totalHoje = 0;
    stats.totalMes = 0;
    stats.sessoesHoje = 0;
    stats.sessoesMes = 0;
    historicoCount = 0;
    historicoIndex = 0;
    jsonDoc["message"] = "Todas as estatísticas e histórico resetados";
  } else {
    jsonDoc["status"] = "error";
    jsonDoc["message"] = "Tipo inválido. Use: hoje, mes ou tudo";
    String response;
    serializeJson(jsonDoc, response);
    server.send(400, "application/json", response);
    return;
  }
  
  salvarEstado();
  jsonDoc["status"] = "success";
  
  String response;
  serializeJson(jsonDoc, response);
  server.send(200, "application/json", response);
}

void apiInfo() {
  jsonDoc.clear();
  jsonDoc["status"] = "success";
  jsonDoc["device"] = "ESP32 Bomba d'Água Controller";
  jsonDoc["version"] = "2.0";
  jsonDoc["chip_id"] = ESP.getEfuseMac();
  jsonDoc["free_heap"] = ESP.getFreeHeap();
  jsonDoc["uptime"] = millis() / 1000;
  jsonDoc["wifi_clients"] = WiFi.softAPgetStationNum();
  
  String response;
  serializeJson(jsonDoc, response);
  server.send(200, "application/json", response);
}

void apiNotFound() {
  jsonDoc.clear();
  jsonDoc["status"] = "error";
  jsonDoc["message"] = "Endpoint não encontrado";
  
  String response;
  serializeJson(jsonDoc, response);
  server.send(404, "application/json", response);
}

/* ================= FUNÇÕES AUXILIARES ================= */

String formatTime(unsigned long seconds) {
  unsigned long hours = seconds / 3600;
  unsigned long minutes = (seconds % 3600) / 60;
  unsigned long secs = seconds % 60;
  
  char buffer[12];
  sprintf(buffer, "%02lu:%02lu:%02lu", hours, minutes, secs);
  return String(buffer);
}

void printWiFiStatus() {
  Serial.println("\n=== Status WiFi ===");
  Serial.print("SSID: ");
  Serial.println(WIFI_SSID);
  Serial.print("IP: ");
  Serial.println(WiFi.softAPIP());
  Serial.print("MAC: ");
  Serial.println(WiFi.softAPmacAddress());
  Serial.println("===================\n");
}

void printAPIRoutes() {
  Serial.println("\n=== Rotas da API ===");
  Serial.println("GET  /api/status      - Status da bomba");
  Serial.println("POST /api/ligar       - Ligar bomba");
  Serial.println("POST /api/desligar    - Desligar bomba");
  Serial.println("POST /api/alternar    - Alternar estado");
  Serial.println("GET  /api/estatisticas- Estatísticas");
  Serial.println("GET  /api/historico   - Histórico");
  Serial.println("GET  /api/datahora    - Data e hora");
  Serial.println("POST /api/reset?tipo= - Resetar estatísticas");
  Serial.println("GET  /api/info        - Info do sistema");
  Serial.println("=====================\n");
}

/* ================= SETUP ================= */

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n=== Inicializando Sistema de Bomba d'Água ===");
  
  // Inicializar EEPROM
  EEPROM.begin(EEPROM_SIZE);
  
  // Configurar pino da bomba
  pinMode(BOMBA_PIN, OUTPUT);
  digitalWrite(BOMBA_PIN, LOW);
  
  // Configurar WiFi como Access Point
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(local_ip, gateway, subnet);
  WiFi.softAP(WIFI_SSID, WIFI_PASS);
  
  // Aguardar WiFi estar pronto
  delay(1000);
  
  printWiFiStatus();
  
  // Inicializar cliente NTP
  timeClient.begin();
  
  // Tentar sincronizar hora
  Serial.println("Sincronizando hora com servidor NTP...");
  for (int i = 0; i < 10; i++) {
    if (timeClient.update()) {
      Serial.print("Hora sincronizada: ");
      Serial.println(timeClient.getFormattedTime());
      break;
    }
    delay(1000);
  }
  
  // Carregar estado salvo
  carregarEstado();
  
  // Configurar rotas da API
  server.on("/api/status", HTTP_GET, apiStatus);
  server.on("/api/ligar", HTTP_POST, apiLigar);
  server.on("/api/desligar", HTTP_POST, apiDesligar);
  server.on("/api/alternar", HTTP_POST, apiAlternar);
  server.on("/api/estatisticas", HTTP_GET, apiEstatisticas);
  server.on("/api/historico", HTTP_GET, apiHistorico);
  server.on("/api/datahora", HTTP_GET, apiDataHora);
  server.on("/api/reset", HTTP_POST, apiReset);
  server.on("/api/info", HTTP_GET, apiInfo);
  
  // Rota para CORS (Cross-Origin Resource Sharing)
  server.onNotFound(apiNotFound);
  
  // Habilitar CORS para todas as rotas
  server.enableCORS(true);
  
  // Iniciar servidor
  server.begin();
  Serial.println("Servidor HTTP iniciado na porta 80");
  
  printAPIRoutes();
  
  Serial.println("=== Sistema pronto para uso ===");
  Serial.println("Conecte-se ao WiFi: " + String(WIFI_SSID));
  Serial.println("Senha: " + String(WIFI_PASS));
  Serial.println("Acesse a interface web via http://192.168.10.1");
}

/* ================= LOOP ================= */

void loop() {
  // Atualizar servidor web
  server.handleClient();
  
  // Atualizar hora NTP periodicamente
  static unsigned long lastNTPUpdate = 0;
  if (millis() - lastNTPUpdate > 60000) { // A cada 1 minuto
    timeClient.update();
    lastNTPUpdate = millis();
    
    // Verificar se precisa resetar estatísticas diárias
    resetEstatisticasDiarias();
  }
  
  // Verificar se a bomba está ligada há muito tempo (proteção)
  if (bombaLigada) {
    unsigned long tempoLigada = (millis() - bombaLigadaMillis) / 1000;
    if (tempoLigada > 3600 * 2) { // 2 horas
      Serial.println("ATENÇÃO: Bomba ligada há mais de 2 horas!");
      // Aqui você pode adicionar desligamento automático se quiser
    }
  }
  
  // Pequena pausa para não sobrecarregar o processador
  delay(10);
}