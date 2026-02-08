// Configurações
const DEFAULT_ESP32_IP = "192.168.10.1";
const DEFAULT_PORT = 80;
const API_BASE_URL = `http://${DEFAULT_ESP32_IP}:${DEFAULT_PORT}/api`;

// Variáveis de estado
let esp32Config = {
    ip: DEFAULT_ESP32_IP,
    port: DEFAULT_PORT,
    baseUrl: API_BASE_URL
};

let bombaLigada = false;
let currentTimerInterval = null;
let isConnected = false;
let connectionCheckInterval = null;

// Elementos da interface
const statusIcon = document.getElementById('statusIcon');
const statusText = document.getElementById('statusText');
const lastAction = document.getElementById('lastAction');
const datetimeElement = document.getElementById('datetime');
const btnOn = document.getElementById('btnOn');
const btnOff = document.getElementById('btnOff');
const btnToggle = document.getElementById('btnToggle');
const currentTimerElement = document.getElementById('currentTimer');
const timerInfo = document.getElementById('timerInfo');
const todayTotalElement = document.getElementById('todayTotal');
const monthTotalElement = document.getElementById('monthTotal');
const historyBody = document.getElementById('historyBody');
const emptyHistoryMessage = document.getElementById('emptyHistoryMessage');
const clearHistoryBtn = document.getElementById('clearHistory');
const refreshHistoryBtn = document.getElementById('refreshHistory');
const connectionStatus = document.getElementById('connectionStatus');
const wifiIcon = document.getElementById('wifiIcon');
const systemIndicator = document.getElementById('systemIndicator');
const systemStatusText = document.getElementById('systemStatusText');

// Elementos de estatísticas
const dailyAvgElement = document.getElementById('dailyAvg');
const monthlyTotalElement = document.getElementById('monthlyTotal');
const weeklyUsageElement = document.getElementById('weeklyUsage');
const sessionsCountElement = document.getElementById('sessionsCount');

// Elementos do modal
const confirmationModal = document.getElementById('confirmationModal');
const modalMessage = document.getElementById('modalMessage');
const confirmActionBtn = document.getElementById('confirmAction');
const cancelActionBtn = document.getElementById('cancelAction');
const closeModalBtns = document.querySelectorAll('.close-modal');

// Elementos do modal de configuração
const configModal = document.getElementById('configModal');
const esp32IpInput = document.getElementById('esp32Ip');
const apiPortInput = document.getElementById('apiPort');
const testConnectionBtn = document.getElementById('testConnection');
const testResult = document.getElementById('testResult');
const saveConfigBtn = document.getElementById('saveConfig');
const cancelConfigBtn = document.getElementById('cancelConfig');

// Gráfico
let usageChart = null;

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
    initApp();
    
    // Event listeners
    btnOn.addEventListener('click', () => requestBombaAction('ligar'));
    btnOff.addEventListener('click', () => requestBombaAction('desligar'));
    btnToggle.addEventListener('click', () => requestBombaAction('alternar'));
    clearHistoryBtn.addEventListener('click', clearHistory);
    refreshHistoryBtn.addEventListener('click', loadHistory);
    confirmActionBtn.addEventListener('click', executePendingAction);
    cancelActionBtn.addEventListener('click', closeModal);
    
    // Fechar modais
    closeModalBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            confirmationModal.classList.remove('active');
            configModal.classList.remove('active');
        });
    });
    
    // Configuração
    testConnectionBtn.addEventListener('click', testConnection);
    saveConfigBtn.addEventListener('click', saveConfig);
    cancelConfigBtn.addEventListener('click', () => configModal.classList.remove('active'));
    
    // Fechar modais ao clicar fora
    [confirmationModal, configModal].forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
    
    // Configuração inicial do ESP32
    loadConfig();
});

// Inicialização da aplicação
async function initApp() {
    // Atualizar data/hora local
    updateLocalDateTime();
    setInterval(updateLocalDateTime, 1000);
    
    // Testar conexão com ESP32
    await testESP32Connection();
    
    // Iniciar atualização periódica
    startPeriodicUpdates();
    
    // Carregar dados iniciais
    loadInitialData();
    
    // Inicializar gráfico
    initChart();
}

// Testar conexão com ESP32
async function testESP32Connection() {
    updateConnectionStatus('connecting', 'Conectando ao ESP32...');
    
    try {
        const response = await fetch(`${esp32Config.baseUrl}/info`, {
            method: 'GET',
            mode: 'cors',
            timeout: 5000
        }).catch(error => {
            throw new Error('Falha na conexão');
        });
        
        if (response.ok) {
            const data = await response.json();
            updateConnectionStatus('connected', `Conectado - ${data.device}`);
            isConnected = true;
            
            // Atualizar data/hora do ESP32
            updateESP32DateTime();
            
            return true;
        } else {
            throw new Error('Resposta não OK');
        }
    } catch (error) {
        console.error('Erro na conexão com ESP32:', error);
        updateConnectionStatus('disconnected', 'Desconectado - Clique para configurar');
        isConnected = false;
        
        // Tentar reconectar automaticamente
        setTimeout(testESP32Connection, 5000);
        return false;
    }
}

// Atualizar status da conexão
function updateConnectionStatus(status, message) {
    connectionStatus.textContent = message;
    systemStatusText.textContent = message;
    
    // Remover todas as classes
    connectionStatus.className = 'connection-status';
    wifiIcon.className = 'fas fa-wifi';
    systemIndicator.className = 'status-indicator';
    
    switch(status) {
        case 'connected':
            connectionStatus.classList.add('connected');
            wifiIcon.classList.add('connected');
            systemIndicator.classList.add('online');
            systemIndicator.classList.remove('offline', 'connecting');
            break;
        case 'disconnected':
            connectionStatus.classList.add('disconnected');
            wifiIcon.classList.add('disconnected');
            systemIndicator.classList.add('offline');
            systemIndicator.classList.remove('online', 'connecting');
            break;
        case 'connecting':
            connectionStatus.classList.add('connecting');
            wifiIcon.classList.add('connecting');
            systemIndicator.classList.add('connecting');
            systemIndicator.classList.remove('online', 'offline');
            break;
    }
}

// Iniciar atualizações periódicas
function startPeriodicUpdates() {
    // Atualizar status a cada 2 segundos
    setInterval(updateBombaStatus, 2000);
    
    // Atualizar estatísticas a cada 10 segundos
    setInterval(loadEstatisticas, 10000);
    
    // Atualizar data/hora do ESP32 a cada 30 segundos
    setInterval(updateESP32DateTime, 30000);
    
    // Verificar conexão a cada 15 segundos
    setInterval(testESP32Connection, 15000);
}

// Carregar dados iniciais
async function loadInitialData() {
    await updateBombaStatus();
    await loadEstatisticas();
    await loadHistory();
}

// Atualizar status da bomba
async function updateBombaStatus() {
    if (!isConnected) return;
    
    try {
        const response = await fetch(`${esp32Config.baseUrl}/status`);
        if (response.ok) {
            const data = await response.json();
            
            bombaLigada = data.bomba === 'ligada';
            updateBombaUI();
            
            // Atualizar timer se a bomba estiver ligada
            if (bombaLigada && data.tempo_atual) {
                updateCurrentTimer(data.tempo_atual);
                if (!currentTimerInterval) {
                    startCurrentTimer();
                }
            } else {
                stopCurrentTimer();
                currentTimerElement.textContent = '00:00:00';
                timerInfo.textContent = 'Bomba está desligada';
            }
            
            // Atualizar última ação
            if (bombaLigada && data.ligada_desde) {
                const date = new Date(data.ligada_desde * 1000);
                lastAction.textContent = `Ligada às ${date.toLocaleTimeString()}`;
            }
        }
    } catch (error) {
        console.error('Erro ao atualizar status:', error);
    }
}

// Atualizar interface da bomba
function updateBombaUI() {
    if (bombaLigada) {
        statusIcon.innerHTML = '<i class="fas fa-toggle-on"></i>';
        statusIcon.className = 'status-icon status-on';
        statusText.textContent = 'LIGADA';
        statusText.style.color = 'var(--secondary)';
        
        btnOn.disabled = true;
        btnOff.disabled = false;
        btnToggle.innerHTML = '<i class="fas fa-stop"></i> DESLIGAR';
        btnToggle.className = 'btn btn-off';
        
        currentTimerElement.classList.add('pulse');
    } else {
        statusIcon.innerHTML = '<i class="fas fa-toggle-off"></i>';
        statusIcon.className = 'status-icon status-off';
        statusText.textContent = 'DESLIGADA';
        statusText.style.color = 'var(--danger)';
        
        btnOn.disabled = false;
        btnOff.disabled = true;
        btnToggle.innerHTML = '<i class="fas fa-play"></i> LIGAR';
        btnToggle.className = 'btn btn-on';
        
        currentTimerElement.classList.remove('pulse');
    }
}

// Iniciar timer atual
function startCurrentTimer() {
    stopCurrentTimer();
    
    currentTimerInterval = setInterval(async () => {
        try {
            const response = await fetch(`${esp32Config.baseUrl}/status`);
            if (response.ok) {
                const data = await response.json();
                if (data.tempo_atual) {
                    updateCurrentTimer(data.tempo_atual);
                }
            }
        } catch (error) {
            console.error('Erro ao atualizar timer:', error);
        }
    }, 1000);
}

// Parar timer atual
function stopCurrentTimer() {
    if (currentTimerInterval) {
        clearInterval(currentTimerInterval);
        currentTimerInterval = null;
    }
}

// Atualizar timer atual
function updateCurrentTimer(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    currentTimerElement.textContent = 
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    
    timerInfo.textContent = `Ligada há ${hours}h ${minutes}m ${secs}s`;
}

// Carregar estatísticas
async function loadEstatisticas() {
    if (!isConnected) return;
    
    try {
        const response = await fetch(`${esp32Config.baseUrl}/estatisticas`);
        if (response.ok) {
            const data = await response.json();
            
            // Atualizar totais
            todayTotalElement.textContent = data.estatisticas.hoje_formatado || '00:00:00';
            monthTotalElement.textContent = data.estatisticas.mes_formatado || '00:00:00';
            
            // Atualizar sessões
            sessionsCountElement.textContent = data.estatisticas.sessoes_hoje || 0;
            
            // Calcular média diária
            if (data.estatisticas.sessoes_hoje > 0) {
                const avg = Math.floor(data.estatisticas.total_hoje / data.estatisticas.sessoes_hoje / 60);
                dailyAvgElement.textContent = `${avg.toString().padStart(2, '0')}:00`;
            }
            
            // Atualizar total mensal
            const monthlyHours = Math.floor(data.estatisticas.total_mes / 3600);
            const monthlyMinutes = Math.floor((data.estatisticas.total_mes % 3600) / 60);
            monthlyTotalElement.textContent = 
                `${monthlyHours.toString().padStart(2, '0')}:${monthlyMinutes.toString().padStart(2, '0')}`;
        }
    } catch (error) {
        console.error('Erro ao carregar estatísticas:', error);
    }
}

// Carregar histórico
async function loadHistory() {
    if (!isConnected) return;
    
    try {
        const response = await fetch(`${esp32Config.baseUrl}/historico`);
        if (response.ok) {
            const data = await response.json();
            
            if (data.count > 0) {
                emptyHistoryMessage.style.display = 'none';
                renderHistory(data.historico);
            } else {
                emptyHistoryMessage.style.display = 'block';
                historyBody.innerHTML = '';
            }
        }
    } catch (error) {
        console.error('Erro ao carregar histórico:', error);
        emptyHistoryMessage.style.display = 'block';
        emptyHistoryMessage.innerHTML = `
            <i class="fas fa-exclamation-triangle fa-2x"></i>
            <p>Erro ao carregar histórico</p>
            <p>${error.message}</p>
        `;
    }
}

// Renderizar histórico
function renderHistory(historico) {
    let tableHTML = '';
    
    historico.forEach(item => {
        const status = item.acao === 'ligar' ? 'Ligada' : 'Desligada';
        const statusClass = item.acao === 'ligar' ? 'on' : 'off';
        const durationDisplay = item.duracao_formatada || 
                               (item.acao === 'ligar' ? '<em>Em andamento</em>' : 'N/A');
        const actionText = item.acao === 'ligar' ? 'Ligou a bomba' : 'Desligou a bomba';
        
        tableHTML += `
            <tr>
                <td>${item.data_hora || formatTimestamp(item.timestamp)}</td>
                <td>${actionText}</td>
                <td>${durationDisplay}</td>
                <td><span class="status-badge ${statusClass}">${status}</span></td>
            </tr>
        `;
    });
    
    historyBody.innerHTML = tableHTML;
}

// Formatar timestamp
function formatTimestamp(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR');
}

// Solicitar ação na bomba
function requestBombaAction(action) {
    if (!isConnected) {
        showNotification('Erro: Não conectado ao ESP32', 'error');
        configModal.classList.add('active');
        return;
    }
    
    let message = '';
    let endpoint = '';
    
    switch(action) {
        case 'ligar':
            message = 'Deseja realmente <strong>ligar</strong> a bomba d\'água?';
            endpoint = '/ligar';
            break;
        case 'desligar':
            message = 'Deseja realmente <strong>desligar</strong> a bomba d\'água?';
            endpoint = '/desligar';
            break;
        case 'alternar':
            message = `Deseja <strong>${bombaLigada ? 'desligar' : 'ligar'}</strong> a bomba d\'água?`;
            endpoint = '/alternar';
            break;
    }
    
    modalMessage.innerHTML = `<i class="fas fa-exclamation-triangle" style="color: var(--warning); margin-right: 10px;"></i> ${message}`;
    confirmActionBtn.onclick = () => executeBombaAction(endpoint);
    confirmationModal.classList.add('active');
}

// Executar ação na bomba
async function executeBombaAction(endpoint) {
    closeModal();
    
    try {
        const response = await fetch(`${esp32Config.baseUrl}${endpoint}`, {
            method: 'POST'
        });
        
        if (response.ok) {
            const data = await response.json();
            showNotification(data.message || 'Ação realizada com sucesso!', 'success');
            
            // Atualizar interface
            setTimeout(() => {
                updateBombaStatus();
                loadEstatisticas();
                loadHistory();
            }, 500);
        } else {
            throw new Error('Erro na resposta do servidor');
        }
    } catch (error) {
        console.error('Erro ao executar ação:', error);
        showNotification('Erro ao executar ação: ' + error.message, 'error');
    }
}

// Limpar histórico
async function clearHistory() {
    if (!isConnected) return;
    
    if (confirm('Tem certeza que deseja limpar todo o histórico?')) {
        try {
            const response = await fetch(`${esp32Config.baseUrl}/reset?tipo=tudo`, {
                method: 'POST'
            });
            
            if (response.ok) {
                showNotification('Histórico limpo com sucesso!', 'success');
                loadHistory();
                loadEstatisticas();
            }
        } catch (error) {
            console.error('Erro ao limpar histórico:', error);
            showNotification('Erro ao limpar histórico', 'error');
        }
    }
}

// Atualizar data/hora do ESP32
async function updateESP32DateTime() {
    if (!isConnected) return;
    
    try {
        const response = await fetch(`${esp32Config.baseUrl}/datahora`);
        if (response.ok) {
            const data = await response.json();
            if (data.full_date) {
                // Atualizar apenas se for diferente da atual
                const currentText = datetimeElement.textContent;
                if (!currentText.includes(data.full_date.substring(0, 20))) {
                    datetimeElement.textContent = data.full_date;
                }
            }
        }
    } catch (error) {
        // Silencioso - não mostrar erro para o usuário
    }
}

// Atualizar data/hora local
function updateLocalDateTime() {
    const now = new Date();
    const options = { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    };
    datetimeElement.textContent = now.toLocaleDateString('pt-BR', options);
}

// Inicializar gráfico
function initChart() {
    const ctx = document.getElementById('usageChart').getContext('2d');
    
    usageChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],
            datasets: [{
                label: 'Tempo de Uso (minutos)',
                data: [45, 60, 30, 75, 90, 50, 65],
                backgroundColor: 'rgba(26, 115, 232, 0.1)',
                borderColor: 'rgba(26, 115, 232, 1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                }
            }
        }
    });
}

// Testar conexão com configuração
async function testConnection() {
    const ip = esp32IpInput.value.trim();
    const port = apiPortInput.value.trim();
    const testUrl = `http://${ip}:${port}/api/info`;
    
    testResult.textContent = 'Testando...';
    testResult.className = 'test-result';
    
    try {
        const response = await fetch(testUrl, { timeout: 3000 });
        if (response.ok) {
            const data = await response.json();
            testResult.textContent = `✓ Conectado - ${data.device}`;
            testResult.className = 'test-result success';
            return true;
        } else {
            throw new Error('Resposta não OK');
        }
    } catch (error) {
        testResult.textContent = '✗ Falha na conexão';
        testResult.className = 'test-result error';
        return false;
    }
}

// Salvar configuração
async function saveConfig() {
    const ip = esp32IpInput.value.trim();
    const port = apiPortInput.value.trim();
    
    if (!ip || !port) {
        showNotification('Preencha todos os campos', 'error');
        return;
    }
    
    // Testar conexão primeiro
    const connected = await testConnection();
    
    if (connected) {
        esp32Config.ip = ip;
        esp32Config.port = port;
        esp32Config.baseUrl = `http://${ip}:${port}/api`;
        
        saveConfigToStorage();
        configModal.classList.remove('active');
        
        // Reconectar com nova configuração
        await testESP32Connection();
        showNotification('Configuração salva com sucesso!', 'success');
    } else {
        showNotification('Não foi possível conectar com essas configurações', 'error');
    }
}

// Carregar configuração do localStorage
function loadConfig() {
    const savedConfig = localStorage.getItem('esp32Config');
    if (savedConfig) {
        esp32Config = JSON.parse(savedConfig);
        esp32IpInput.value = esp32Config.ip;
        apiPortInput.value = esp32Config.port;
    }
}

// Salvar configuração no localStorage
function saveConfigToStorage() {
    localStorage.setItem('esp32Config', JSON.stringify(esp32Config));
}

// Mostrar notificação
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        background-color: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#2196f3'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 1001;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 10px;
        animation: slideIn 0.3s ease, fadeOut 0.3s ease 2.7s forwards;
    `;
    
    const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle';
    notification.innerHTML = `<i class="fas ${icon}"></i> ${message}`;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

// Adicionar estilos CSS para as notificações
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
    }
    
    .notification {
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        z-index: 1001;
        display: flex;
        align-items: center;
        gap: 10px;
        animation: slideIn 0.3s ease, fadeOut 0.3s ease 2.7s forwards;
    }
    
    .notification.success {
        background: linear-gradient(90deg, #28a745, #20c997);
    }
    
    .notification.error {
        background: linear-gradient(90deg, #dc3545, #fd7e14);
    }
    
    .notification.info {
        background: linear-gradient(90deg, #2196f3, #21cbf3);
    }
`;
document.head.appendChild(style);

// Fechar modal
function closeModal() {
    confirmationModal.classList.remove('active');
}

// Executar ação pendente
async function executePendingAction() {
    // Esta função agora é substituída por executeBombaAction
    closeModal();
}