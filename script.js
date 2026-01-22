document.getElementById("btnLigar").addEventListener("click", ligarBomba);
document.getElementById("btnDesligar").addEventListener("click", desligarBomba);

function ligarBomba() {
    fetch("/ligar")
        .then(() => console.log("Bomba ligada"))
        .catch(err => console.error("Erro:", err));
}

function desligarBomba() {
    fetch("/desligar")
        .then(() => console.log("Bomba desligada"))
        .catch(err => console.error("Erro:", err));
}
