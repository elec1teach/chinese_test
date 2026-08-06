// URL สำหรับใช้บันทึกข้อมูลลงชีตตอนสอบเสร็จ (เก็บไว้ตามเดิม)
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyoo5FbqReEwFxYecwWZANl65I2u45wUZ0oq5MRl162mscLZRK7CZ1p22nt3CQP86_W/exec";
const ADMIN_PASSWORD = "1234"; 

const applauseAudio = new Audio('https://actions.google.com/sounds/v1/crowds/crowd_cheer.ogg');

const firebaseConfig = {
    apiKey: "AIzaSyBK9hqf4TBb_ISgEtE5Qu4AjmGHZ5zhShk",
    authDomain: "engteststation.firebaseapp.com",
    databaseURL: "https://engteststation-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "engteststation",
    storageBucket: "engteststation.firebasestorage.app",
    messagingSenderId: "719237352141",
    appId: "1:719237352141:web:04359357c9646c5bcd3784"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let masterQuestions = []; 
let questions = [];       
let currentQuestion = 0;
let totalScore = 0;
let passCount = 0;
let failCount = 0;

let recognition;
let totalTimeLeftSeconds = 0;
let testTimerInterval = null;
let isTestRunning = false; 
let isRunning = false; 
let isAdminLoggedIn = false;
let currentStock = { slot1: 0, slot2: 0 };
let currentMachineStatus = 'ready'; 

let nextQuestionTimer = null;
let displayInterval = null; 
let startMicDelayTimeout = null; 
let questionTimeout = null;     

let adminConfig = {
    passRequirement: 5,
    questionCount: 10,
    difficulty: "ALL",
    testDurationSeconds: 60,
    cancelRequirement: false,
    forceLevelControl: false, 
    forcedLevel: "Vocational"
};

let initialCountdownTimer = null;
let initialTime = 10;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playBeepSound() {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    let osc = audioCtx.createOscillator();
    let gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime); 
    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2); 
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
}

function applyLevelControl() {
    const userContainer = document.getElementById("userLevelContainer");
    const userSelect = document.getElementById("userLevel");
    const popup = document.getElementById("initialLevelModal");

    if (adminConfig.forceLevelControl) {
        userContainer.style.display = "none";
        userSelect.value = adminConfig.forcedLevel;
        if (popup.style.display === "flex") {
            clearInterval(initialCountdownTimer);
            popup.style.display = "none";
            fetchQuestions(); // เปลี่ยนจาก GAS เป็น JSON
        }
    } else {
        userContainer.style.display = "flex";
    }
}

function showInitialPopup() {
    if (adminConfig.forceLevelControl) {
        document.getElementById("userLevel").value = adminConfig.forcedLevel;
        fetchQuestions(); // เปลี่ยนจาก GAS เป็น JSON
        return;
    }

    document.getElementById("initialLevelModal").style.display = "flex";
    initialTime = 10;
    document.getElementById("initialTimer").innerText = initialTime;
    document.getElementById("popupLevelSelect").value = "Vocational"; 

    initialCountdownTimer = setInterval(() => {
        initialTime--;
        document.getElementById("initialTimer").innerText = initialTime;
        if (initialTime <= 0) {
            clearInterval(initialCountdownTimer);
            confirmInitialLevel(); 
        }
    }, 1000);
}

function confirmInitialLevel() {
    clearInterval(initialCountdownTimer);
    document.getElementById("initialLevelModal").style.display = "none";
    if (!adminConfig.forceLevelControl) {
        const selectedLevel = document.getElementById("popupLevelSelect").value;
        document.getElementById("userLevel").value = selectedLevel;
    }
    fetchQuestions(); // เปลี่ยนจาก GAS เป็น JSON
}

window.onload = async () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("เบราว์เซอร์ของคุณไม่รองรับระบบแยกแยะเสียง กรุณาเปิดด้วย Google Chrome หรือ Safari");
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = function(event){
        if(!isRunning) return;
        isRunning = false;
        clearTimeout(questionTimeout); 

        const speechResult = event.results[0][0].transcript;
        const target = questions[currentQuestion].english;
        const score = similarity(target, speechResult);

        document.getElementById("heardText").innerHTML = "AI ได้ยิน: " + speechResult;
        document.getElementById("score").innerHTML = score + "%";
        totalScore += score;
        document.getElementById("totalScore").innerHTML = totalScore;

        if(score >= 80){
            passCount++;
            document.getElementById("passCount").innerHTML = passCount;
            document.getElementById("status").innerHTML = "PASS ✅";
            document.getElementById("status").className = "status pass";
            playPassSound();
        } else {
            failCount++;
            document.getElementById("failCount").innerHTML = failCount;
            document.getElementById("status").innerHTML = "FAIL ❌";
            document.getElementById("status").className = "status fail";
            playFailSound();
        }

        document.getElementById("startBtn").disabled = true;

        nextQuestionTimer = setTimeout(() => {
            if (totalTimeLeftSeconds > 0 || adminConfig.cancelRequirement) {
                nextQuestion();
            }
        }, 1200);
    };

    recognition.onerror = function(event){
        console.log("Recognition Error:", event.error);
        if(!isRunning) return;
        isRunning = false; 
        clearTimeout(questionTimeout);
        document.getElementById("status").innerHTML = "ไมโครโฟนมีปัญหา ❌";
        document.getElementById("status").className = "status fail";
        document.getElementById("heardText").innerHTML = "ระบบไมค์ถูกขัดจังหวะ ข้ามไปข้อถัดไป...";
        
        failCount++;
        document.getElementById("failCount").innerHTML = failCount;
        playFailSound();
        
        nextQuestionTimer = setTimeout(() => {
            if (totalTimeLeftSeconds > 0 || adminConfig.cancelRequirement) {
                nextQuestion();
            }
        }, 1500);
    };

    recognition.onend = function() {
        if(isRunning) { 
            console.log("Recognition ended unexpectedly."); 
            isRunning = false;
            clearTimeout(questionTimeout);
            document.getElementById("status").innerHTML = "เสียงเงียบเกินไป ⚠️";
            document.getElementById("status").className = "status fail";
            document.getElementById("heardText").innerHTML = "ไม่พบเสียงพูดข้ามไปข้อถัดไป...";
            
            failCount++;
            document.getElementById("failCount").innerHTML = failCount;
            playFailSound();

            nextQuestionTimer = setTimeout(() => {
                if (totalTimeLeftSeconds > 0 || adminConfig.cancelRequirement) {
                    nextQuestion();
                }
            }, 1500);
        }
    };

    monitorMaintenance(); 
    monitorAdminSettings(); 
    showInitialPopup(); 
    monitorMachine(); 
    monitorStock(); 
    monitorRewards(); 
};

function retryConnection() {
    document.getElementById("reconnectBtn").style.display = "none";
    const startBtn = document.getElementById("startBtn");
    startBtn.style.display = "inline-block";
    startBtn.disabled = true;
    startBtn.innerHTML = "⏳ กรุณารอสักครู่";
    
    document.getElementById("questionNumber").innerHTML = "ระบบกำลังเชื่อมต่อ...";
    document.getElementById("englishText").innerHTML = "Loading...";
    document.getElementById("thaiText").innerHTML = "กำลังเตรียมข้อมูลข้อสอบ";
    
    fetchQuestions(); // โหลดจาก JSON แทน
}

function openRewardModal() { document.getElementById("rewardModal").style.display = "flex"; }
function closeRewardModal() { document.getElementById("rewardModal").style.display = "none"; }

function monitorRewards() {
    db.ref('machine/rewards').on('value', (snap) => {
        const data = snap.val();
        if (data) {
            if (data.slot1) document.getElementById("rewardImg1").src = data.slot1;
            if (data.slot2) document.getElementById("rewardImg2").src = data.slot2;
        }
    });
}

function uploadImage(slot) {
    const inputId = slot === 'slot1' ? 'adminImgSlot1' : 'adminImgSlot2';
    const fileInput = document.getElementById(inputId);
    const file = fileInput.files[0];

    if (!file) {
        alert("กรุณาเลือกไฟล์ภาพก่อนกด Upload ครับ");
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 600;
            let scaleSize = MAX_WIDTH / img.width;
            if (scaleSize > 1) scaleSize = 1; 

            canvas.width = img.width * scaleSize;
            canvas.height = img.height * scaleSize;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.6);

            db.ref(`machine/rewards/${slot}`).set(dataUrl)
                .then(() => alert(`✅ อัปโหลดและบันทึกภาพ ${slot === 'slot1' ? 'Slot A' : 'Slot B'} เรียบร้อยแล้ว!`))
                .catch(err => alert("❌ เกิดข้อผิดพลาดในการอัปโหลดภาพ: " + err));
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function selectUserMode(mode) {
    if (isRunning || isTestRunning) {
        alert("⚠️ กรุณารอให้จบการทดสอบหรือฝึกซ้อมรอบปัจจุบันก่อนเปลี่ยนโหมดครับ");
        return;
    }
    const btnReward = document.getElementById("modeRewardBtn");
    const btnPractice = document.getElementById("modePracticeBtn");

    if (mode === 'practice') {
        adminConfig.cancelRequirement = true; 
        btnPractice.classList.add("active");
        btnReward.classList.remove("active");
    } else {
        adminConfig.cancelRequirement = false; 
        btnReward.classList.add("active");
        btnPractice.classList.remove("active");
    }

    updateUIBasedOnState();
    if (questions.length > 0) prepareQuestions();
}

function openRankModal() {
    document.getElementById("rankModal").style.display = "flex";
    fetchRankData();
}
function closeRankModal() { document.getElementById("rankModal").style.display = "none"; }

async function fetchRankData() {
    const tableBody = document.getElementById("rankTableBody");
    tableBody.innerHTML = '<div class="loading-rank">กำลังโหลดข้อมูลอันดับ... ⏳</div>';

    try {
        const response = await fetch(GOOGLE_SCRIPT_URL + "?action=getRank");
        const data = await response.json();
        
        let rankData = [];
        if(Array.isArray(data) && data.length > 0 && data[0].name) {
             rankData = data; 
        } else {
             rankData = [
                 { rank: 1, name: "ยังไม่มีข้อมูล", attempts: 0, score: 0 }
             ];
        }
        renderRankTable(rankData);
    } catch (error) {
        console.error("Error fetching rank:", error);
        tableBody.innerHTML = '<div class="loading-rank" style="color:var(--red);">ไม่สามารถเชื่อมต่อตารางคะแนนได้ ❌</div>';
    }
}

function renderRankTable(data) {
    const tableBody = document.getElementById("rankTableBody");
    tableBody.innerHTML = "";

    if (data.length === 0) {
        tableBody.innerHTML = '<div class="loading-rank">ยังไม่มีข้อมูลผู้ทดสอบ 🌟</div>';
        return;
    }

    data.forEach((user, index) => {
        const actualRank = index + 1; 
        let rankClass = "";
        if (actualRank === 1) rankClass = "rank-1";
        else if (actualRank === 2) rankClass = "rank-2";
        else if (actualRank === 3) rankClass = "rank-3";

        const rowHTML = `
            <div class="rank-row ${rankClass}">
                <div class="rank-badge">${actualRank}</div>
                <div style="text-align: left; padding-left: 10px; font-weight: 500;">${user.name}</div>
                <div>${user.attempts}</div>
                <div class="rank-score">${user.score}</div>
            </div>
        `;
        tableBody.innerHTML += rowHTML;
    });
}

function monitorMaintenance() {
    db.ref('machine/maintenance').on('value', (snap) => {
        const data = snap.val() || { isActive: false, date: '', time: '', message: '' };
        
        document.getElementById("maintSwitch").checked = data.isActive;
        document.getElementById("adminMaintDate").value = data.date || "";
        document.getElementById("adminMaintTime").value = data.time || "";
        document.getElementById("adminMaintMsg").value = data.message || "";

        const overlay = document.getElementById("maintenanceOverlay");
        if(data.isActive) {
            overlay.style.display = "flex";
            let dateStr = data.date;
            if(dateStr) {
                const d = new Date(dateStr);
                dateStr = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
            }
            document.getElementById("maintDateUI").innerText = dateStr || "เร็วๆ นี้";
            document.getElementById("maintTimeUI").innerText = data.time || "-";
            document.getElementById("maintMsgUI").innerText = data.message || "กำลังดำเนินการปรับปรุงระบบ ขออภัยในความไม่สะดวกครับ";
        } else {
            overlay.style.display = "none";
        }
    });
}

function toggleMaintenance(isActive) { db.ref('machine/maintenance/isActive').set(isActive); }

function saveMaintenanceInfo() {
    const date = document.getElementById("adminMaintDate").value;
    const time = document.getElementById("adminMaintTime").value;
    const msg = document.getElementById("adminMaintMsg").value;
    
    db.ref('machine/maintenance/date').set(date);
    db.ref('machine/maintenance/time').set(time);
    db.ref('machine/maintenance/message').set(msg);
    
    alert("บันทึกข้อมูลแจ้งเตือน Maintenance สำเร็จเรียบร้อยแล้ว!");
}

// 📌 จุดสำคัญที่เปลี่ยนจากการดึงด้วย GAS เป็นไฟล์ Local JSON
async function fetchQuestions() {
    try {
        const response = await fetch('./questions.json');
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();

        if (Array.isArray(data) && data.length > 0) {
            masterQuestions = data;
            document.getElementById("reconnectBtn").style.display = "none";
            document.getElementById("startBtn").style.display = "inline-block";
            prepareQuestions(); 
        } else {
            throw new Error("Empty Data in JSON");
        }
    } catch (error) {
        console.error("Error fetching questions:", error);
        document.getElementById("questionNumber").innerHTML = "การเชื่อมต่อขัดข้อง";
        document.getElementById("englishText").innerHTML = "Connection<br>Error";
        document.getElementById("thaiText").innerHTML = "ไม่สามารถเชื่อมต่อไฟล์ questions.json ได้";
        
        document.getElementById("startBtn").style.display = "none";
        document.getElementById("reconnectBtn").style.display = "inline-block";
    }
}

function prepareQuestions() {
    if (masterQuestions.length === 0) return;

    const selectedLevel = adminConfig.forceLevelControl 
                          ? adminConfig.forcedLevel 
                          : document.getElementById("userLevel").value;

    let levelFiltered = masterQuestions.filter(q => q.level === selectedLevel);

    if (levelFiltered.length === 0) {
        document.getElementById("englishText").innerHTML = "ไม่มีข้อสอบระดับนี้";
        document.getElementById("thaiText").innerHTML = "กรุณาตรวจสอบว่ามีข้อมูลในไฟล์ questions.json หรือไม่";
        questions = [];
        return;
    }

    let finalFiltered = levelFiltered;
    if (adminConfig.difficulty !== "ALL") {
        finalFiltered = levelFiltered.filter(q => q.difficulty && q.difficulty.toUpperCase() === adminConfig.difficulty);
        if (finalFiltered.length === 0) {
            finalFiltered = levelFiltered;
        }
    }

    let shuffled = finalFiltered.sort(() => 0.5 - Math.random());
    questions = shuffled.slice(0, adminConfig.questionCount);
    currentQuestion = 0;

    const startBtn = document.getElementById("startBtn");
    startBtn.onclick = startRecognition;

    if(!isTestRunning) {
        loadQuestion(0);
    }
    updateUIBasedOnState(); 
}

function renderSequentialText(sentence) {
    const container = document.getElementById("englishText");
    container.innerHTML = ""; 
    
    const words = sentence.split(" ");
    if(words.length === 0) return;
    let wordIndex = 0;
    
    words.forEach(word => {
        const span = document.createElement("span");
        span.innerText = word + " ";
        span.style.opacity = "0"; 
        span.style.transition = "opacity 0.2s ease-in"; 
        container.appendChild(span);
    });

    const spans = container.querySelectorAll("span");
    clearInterval(displayInterval);
    
    const intervalTime = Math.floor(5000 / words.length);
    
    displayInterval = setInterval(() => {
        if (wordIndex < spans.length) {
            spans[wordIndex].style.opacity = "1";
            wordIndex++;
        } else {
            clearInterval(displayInterval);
        }
    }, intervalTime); 
}

function loadQuestion(index){
    if (!questions || questions.length === 0) return;

    document.getElementById("questionNumber").innerHTML = "ข้อที่ " + (index + 1) + " / " + questions.length;
    
    if (adminConfig.cancelRequirement) {
        document.getElementById("englishText").innerHTML = questions[index].english;
    } else {
        document.getElementById("englishText").innerHTML = '<span style="font-size: 24px; color: var(--muted); font-weight: normal;">🔒 กด "เริ่มพูด" เพื่อดูประโยค (รวมเวลา 10 วินาที)</span>';
    }
    
    document.getElementById("thaiText").innerHTML = questions[index].thai;
    document.getElementById("score").innerHTML = "0%";
    document.getElementById("status").innerHTML = "รอเริ่มทดสอบ";
    document.getElementById("status").className = "status";
    document.getElementById("heardText").innerHTML = "AI พร้อมรับเสียง...";
    
    document.getElementById("audioControls").style.display = "flex";
    
    const listenBtn = document.getElementById("listenBtn");
    if (listenBtn) {
        listenBtn.style.display = adminConfig.cancelRequirement ? "flex" : "none";
    }
    
    const skipBtn = document.getElementById("skipBtn");
    if (skipBtn) {
        skipBtn.style.display = "flex";
    }

    if(!isTestRunning) { updateTimerDisplay(adminConfig.testDurationSeconds); }

    const startBtn = document.getElementById("startBtn");
    startBtn.disabled = false;
    startBtn.innerHTML = "🎤 เริ่มพูด";
}

function nextQuestion(){
    clearInterval(displayInterval); 
    clearTimeout(nextQuestionTimer);
    clearTimeout(startMicDelayTimeout);
    clearTimeout(questionTimeout); 
    stopSentenceAudio();
    
    if (isRunning) {
        isRunning = false;
        try { recognition.stop(); } catch(e) {}
    }
    
    currentQuestion++;
    if(currentQuestion >= questions.length){
        evaluateFinalResult();
    } else {
        loadQuestion(currentQuestion);
    }
}

function monitorAdminSettings() {
    db.ref('machine/config').on('value', (snap) => {
        const conf = snap.val();
        if (conf) {
            adminConfig.passRequirement = conf.passRequirement !== undefined ? conf.passRequirement : 5;
            adminConfig.questionCount = conf.questionCount !== undefined ? conf.questionCount : 10;
            adminConfig.difficulty = conf.difficulty || "ALL";
            adminConfig.testDurationSeconds = conf.testDurationSeconds !== undefined ? conf.testDurationSeconds : 60;
            adminConfig.forceLevelControl = conf.forceLevelControl || false;
            adminConfig.forcedLevel = conf.forcedLevel || "Vocational";
        }

        document.getElementById("adminPassReqUI").innerText = adminConfig.passRequirement;
        document.getElementById("adminQuestionCountUI").innerText = adminConfig.questionCount;
        document.getElementById("adminDifficulty").value = adminConfig.difficulty;

        let m = Math.floor(adminConfig.testDurationSeconds / 60);
        let s = adminConfig.testDurationSeconds % 60;
        document.getElementById("adminTimeMin").value = m;
        document.getElementById("adminTimeSec").value = s;

        document.getElementById("adminForceLevelSwitch").checked = adminConfig.forceLevelControl;
        document.getElementById("adminForcedLevelSelect").value = adminConfig.forcedLevel;
        document.getElementById("adminLevelSelectContainer").style.display = adminConfig.forceLevelControl ? "flex" : "none";

        applyLevelControl();

        if (!isTestRunning) {
            updateTimerDisplay(adminConfig.testDurationSeconds);
            prepareQuestions();
        }
        updateUIBasedOnState(); 
    });
}

function toggleLevelControl(isForced) {
    db.ref('machine/config/forceLevelControl').set(isForced);
    if(isForced) {
        const currentAdminLevel = document.getElementById("adminForcedLevelSelect").value;
        db.ref('machine/config/forcedLevel').set(currentAdminLevel);
    }
}

function setAdminForcedLevel() {
    const level = document.getElementById("adminForcedLevelSelect").value;
    db.ref('machine/config/forcedLevel').set(level);
}

function updateAdminConfig(key, change) {
    let newVal = adminConfig[key] + change;
    if (newVal < 1) newVal = 1; 
    db.ref(`machine/config/${key}`).set(newVal);
}

function updateDifficulty() {
    let val = document.getElementById("adminDifficulty").value;
    db.ref('machine/config/difficulty').set(val);
}

function updateTestTime() {
    let m = parseInt(document.getElementById("adminTimeMin").value) || 0;
    let s = parseInt(document.getElementById("adminTimeSec").value) || 0;
    let totalSecs = (m * 60) + s;
    if (totalSecs >= 1) {
        db.ref('machine/config/testDurationSeconds').set(totalSecs);
        alert("บันทึกเวลาทดสอบเรียบร้อย: " + totalSecs + " วินาที");
    } else {
        alert("กรุณาใส่เวลาอย่างน้อย 1 วินาที");
    }
}

function updateUIBasedOnState() {
    const ui = document.getElementById("machineStatusUI");
    const startBtn = document.getElementById("startBtn");
    const audioControls = document.getElementById("audioControls"); 
    const listenBtn = document.getElementById("listenBtn");
    const skipBtn = document.getElementById("skipBtn");
    const userLevelSelect = document.getElementById("userLevel");

    if (isRunning || isTestRunning) {
        userLevelSelect.disabled = true;
        return;
    } else {
        userLevelSelect.disabled = false;
    }

    if (adminConfig.cancelRequirement) {
        ui.innerHTML = "PRACTICE MODE";
        ui.style.color = "#b56cff"; 
        ui.style.background = "rgba(181, 108, 255, 0.08)";
        ui.style.borderColor = "rgba(181, 108, 255, 0.25)";
        
        if (currentQuestion >= questions.length && questions.length > 0) {
            startBtn.disabled = false;
            startBtn.innerHTML = "🔄 เริ่มฝึกใหม่";
            startBtn.onclick = prepareQuestions; 
            if (audioControls) audioControls.style.display = "none"; 
        } else if (questions.length > 0) {
            startBtn.disabled = false;
            startBtn.innerHTML = "🎤 เริ่มพูด";
            startBtn.onclick = startRecognition;
            if (audioControls) {
                audioControls.style.display = "flex";
                if (listenBtn) listenBtn.style.display = "flex";
                if (skipBtn) skipBtn.style.display = "flex";
            }
        }
        return; 
    }

    ui.style.background = "rgba(29,255,149,0.08)";
    ui.style.borderColor = "rgba(29,255,149,0.25)";
    startBtn.onclick = startRecognition; 

    if(currentMachineStatus === 'ready') {
        ui.innerHTML = "MACHINE READY";
        ui.style.color = "#1dff95";
        
        if (currentQuestion >= questions.length && questions.length > 0) {
             startBtn.disabled = true;
             startBtn.innerHTML = "รอรอบต่อไป";
             if (audioControls) audioControls.style.display = "none";
        } else if (questions.length > 0) {
            startBtn.disabled = false;
            startBtn.innerHTML = "🎤 เริ่มพูด";
            if (audioControls) {
                audioControls.style.display = "flex";
                if (listenBtn) listenBtn.style.display = "none";
                if (skipBtn) skipBtn.style.display = "flex";
            }
        }
    } else if (currentMachineStatus === 'unlocked') {
        ui.innerHTML = "MACHINE UNLOCKED";
        ui.style.color = "#35d8ff";
        startBtn.disabled = true;
        startBtn.innerHTML = "🎁 โปรดเลือกของรางวัลที่ตู้";
        if (audioControls) audioControls.style.display = "none";
    } else { 
        ui.innerHTML = "MACHINE BUSY";
        ui.style.color = "#ff4d6d";
        startBtn.disabled = true;
        startBtn.innerHTML = "🔒 รอคิวใช้งาน";
        if (audioControls) audioControls.style.display = "none";
    }
}

function monitorMachine() {
    db.ref('machine/status').on('value', (snap) => {
        currentMachineStatus = snap.val() || 'ready';
        updateUIBasedOnState(); 
    });
}

function openAdminModal() {
    document.getElementById("adminModal").style.display = "flex";
    if(isAdminLoggedIn) {
        document.getElementById("adminLoginGroup").style.display = "none";
        document.getElementById("adminControlGroup").style.display = "block";
    } else {
        document.getElementById("adminLoginGroup").style.display = "block";
        document.getElementById("adminControlGroup").style.display = "none";
        document.getElementById("adminError").style.display = "none";
        document.getElementById("adminPassword").value = "";
    }
}

function closeAdminModal() { document.getElementById("adminModal").style.display = "none"; }

function verifyAdmin() {
    const pass = document.getElementById("adminPassword").value;
    if(pass === ADMIN_PASSWORD) {
        isAdminLoggedIn = true;
        document.getElementById("adminLoginGroup").style.display = "none";
        document.getElementById("adminControlGroup").style.display = "block";
    } else {
        document.getElementById("adminError").style.display = "block";
    }
}

function setSystemStatus(status) {
    db.ref('machine/status').set(status)
        .then(() => { 
            if (status === 'ready') {
                alert("✅ ระบบถูกตั้งสถานะเป็น Ready เรียบร้อยแล้ว!");
                prepareQuestions(); 
            } else if (status === 'unlocked') {
                alert("🔓 ระบบถูกตั้งสถานะเป็น Unlocked เรียบร้อยแล้ว!");
            } else if (status === 'busy') {
                alert("🔒 ระบบถูกตั้งสถานะเป็น Busy เรียบร้อยแล้ว!");
            }
        })
        .catch((error) => alert("❌ เกิดข้อผิดพลาด: " + error));
}

function updateStock(slot, changeAmount) {
    let newValue = currentStock[slot] + changeAmount;
    if (newValue < 0) newValue = 0;
    db.ref(`machine/stock/${slot}`).set(newValue);
}

function monitorStock() {
    db.ref('machine/stock').on('value', (snap) => {
        const data = snap.val();
        if (data) {
            currentStock.slot1 = data.slot1 || 0;
            currentStock.slot2 = data.slot2 || 0;
            document.getElementById("slot1StockUI").innerText = currentStock.slot1;
            document.getElementById("slot2StockUI").innerText = currentStock.slot2;
            document.getElementById("rewardStock1UI").innerText = currentStock.slot1;
            document.getElementById("rewardStock2UI").innerText = currentStock.slot2;
        }
    });
}

function updateTimerDisplay(seconds) {
    let m = Math.floor(seconds / 60);
    let s = seconds % 60;
    document.getElementById("countdown").innerHTML = (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
}

function startGlobalTimer() {
    isTestRunning = true;
    totalTimeLeftSeconds = adminConfig.testDurationSeconds;
    updateTimerDisplay(totalTimeLeftSeconds);

    testTimerInterval = setInterval(() => {
        totalTimeLeftSeconds--;
        updateTimerDisplay(totalTimeLeftSeconds);

        if (totalTimeLeftSeconds <= 0) {
            clearInterval(testTimerInterval);
            forceEndTest();
        }
    }, 1000);
}

function forceEndTest() {
    isRunning = false;
    clearTimeout(startMicDelayTimeout);
    clearTimeout(questionTimeout);
    try { recognition.stop(); } catch(e){}
    
    document.getElementById("status").innerHTML = "หมดเวลาทดสอบรวม ⏰";
    document.getElementById("status").className = "status fail";
    document.getElementById("heardText").innerHTML = "หมดเวลาการทำแบบทดสอบ";
    document.getElementById("audioControls").style.display = "none";
    clearInterval(displayInterval); 
    playFailSound();
    
    setTimeout(() => { evaluateFinalResult(); }, 2000);
}

function startRecognition() {
    stopSentenceAudio(); 
    clearInterval(displayInterval); 
    clearTimeout(questionTimeout); 
    clearTimeout(startMicDelayTimeout);
    
    const studentName = document.getElementById("studentName").value;
    if (studentName.trim() === "") {
        alert("กรุณากรอกชื่อผู้เข้าทดสอบก่อนเริ่มใช้งานครับ!");
        document.getElementById("studentName").focus();
        return;
    }

    if (!isTestRunning) {
        totalScore = 0; passCount = 0; failCount = 0;
        document.getElementById("totalScore").innerHTML = 0;
        document.getElementById("passCount").innerHTML = 0;
        document.getElementById("failCount").innerHTML = 0;
        startGlobalTimer();
    }

    isRunning = false; 
    document.getElementById("startBtn").disabled = true;
    document.getElementById("startBtn").innerHTML = "⏳ กำลังแสดงโจทย์ (5 วินาที)";
    document.getElementById("status").innerHTML = "กำลังแสดงประโยคข้อสอบ...";
    document.getElementById("status").className = "status";
    document.getElementById("heardText").innerHTML = "เตรียมอ่านประโยคเมื่อไมโครโฟนเปิดใน 5 วินาที...";

    renderSequentialText(questions[currentQuestion].english);

    startMicDelayTimeout = setTimeout(() => {
        if (!isTestRunning && totalTimeLeftSeconds <= 0) return;
        isRunning = true;
        playBeepSound();
        
        document.getElementById("startBtn").innerHTML = "🎙️ กำลังฟัง... (เหลือ 5 วินาที)";
        document.getElementById("status").innerHTML = "🎙️ กำลังฟังเสียงของคุณ...";
        document.getElementById("heardText").innerHTML = "พูดตอบได้เลยครับ...";

        try { recognition.start(); } catch (e) { console.error("Mic start error:", e); }

        questionTimeout = setTimeout(() => {
            if (isRunning) {
                isRunning = false;
                try { recognition.stop(); } catch(e) {}
                
                document.getElementById("status").innerHTML = "หมดเวลาพูด ❌";
                document.getElementById("status").className = "status fail";
                document.getElementById("heardText").innerHTML = "หมดเวลา 5 วินาที คุณไม่ได้พูดหรือตอบไม่ทันเวลา";
                
                failCount++;
                document.getElementById("failCount").innerHTML = failCount;
                playFailSound();
                document.getElementById("startBtn").disabled = true;
                
                nextQuestionTimer = setTimeout(() => {
                    if (totalTimeLeftSeconds > 0 || adminConfig.cancelRequirement) {
                        nextQuestion();
                    }
                }, 1500);
            }
        }, 5000);

    }, 5000);
}

function evaluateFinalResult() {
    clearInterval(testTimerInterval);
    clearInterval(displayInterval); 
    clearTimeout(startMicDelayTimeout);
    clearTimeout(questionTimeout);
    isTestRunning = false;
    
    document.getElementById("audioControls").style.display = "none";
    document.getElementById("userLevel").disabled = false;
    
    const name = document.getElementById("studentName").value || "Unknown User";

    document.getElementById("englishText").innerHTML = "Test Completed!";
    document.getElementById("thaiText").innerHTML = "สิ้นสุดการทดสอบ";
    document.getElementById("questionNumber").innerHTML = "สรุปผลคะแนน";

    let finalPercent = Math.round((passCount / adminConfig.questionCount) * 100);
    document.getElementById("score").innerHTML = finalPercent + "%";

    if (passCount >= adminConfig.passRequirement) {
        if (adminConfig.cancelRequirement) { 
            document.getElementById("status").innerHTML = "🎉 ผ่านเกณฑ์! (โหมดฝึกซ้อม)";
            document.getElementById("status").className = "status pass";
            document.getElementById("startBtn").innerHTML = "🔄 เริ่มฝึกฝนใหม่";
            document.getElementById("startBtn").disabled = false;
            document.getElementById("startBtn").onclick = prepareQuestions; 
            db.ref('machine/status').set('ready'); 
            applauseAudio.play().catch(e => console.log("Audio play error:", e));
        } else {
            let otpCode = Math.floor(1000 + Math.random() * 9000).toString(); 
            let expireTime = Date.now() + (5 * 60 * 1000); 
            db.ref('machine/otps/' + otpCode).set({
                valid: true, expire: expireTime, userName: name 
            }).then(() => {
                document.getElementById("status").innerHTML = "🎉 รหัสรับรางวัล: " + otpCode;
                document.getElementById("status").className = "status pass";
                document.getElementById("startBtn").innerHTML = "กดรหัสนี้ที่ตู้ (หมดอายุใน 5 นาที)";
                document.getElementById("startBtn").disabled = true;
                applauseAudio.play().catch(e => console.log("Audio play error:", e));
            });
        }
    } else {
        if (adminConfig.cancelRequirement) {
            document.getElementById("status").innerHTML = "😢 ไม่ผ่านเกณฑ์ ลองพยายามใหม่นะ (โหมดฝึกซ้อม)";
            document.getElementById("status").className = "status fail";
            document.getElementById("startBtn").innerHTML = "🔄 เริ่มฝึกฝนใหม่";
            document.getElementById("startBtn").disabled = false;
            document.getElementById("startBtn").onclick = prepareQuestions;
        } else {
            document.getElementById("status").innerHTML = "😢 ไม่ผ่านเกณฑ์ ลองพยายามใหม่นะ";
            document.getElementById("status").className = "status fail";
            document.getElementById("startBtn").innerHTML = "จบการทดสอบ";
            document.getElementById("startBtn").disabled = true;
            db.ref('machine/status').set('ready'); 
        }
    }

    saveToGoogleSheet(name, totalScore, passCount, failCount);
}

function similarity(s1, s2) {
    let longer = s1.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    let shorter = s2.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    if (longer.length < shorter.length) { let temp = longer; longer = shorter; shorter = temp; }
    if (longer.length == 0) return 100;
    
    let longerLength = longer.length;
    let costs = new Array();
    for (let i = 0; i <= longer.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= shorter.length; j++) {
            if (i == 0) costs[j] = j;
            else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (longer.charAt(i - 1) != shorter.charAt(j - 1))
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[shorter.length] = lastValue;
    }
    let score = Math.round(((longerLength - costs[shorter.length]) / parseFloat(longerLength)) * 100);
    return score > 100 ? 100 : score;
}

function saveToGoogleSheet(name, score, pass, fail) {
    // ฟังก์ชันนี้ยังคงเรียกใช้ GAS URL เดิมเพื่อให้บันทึกข้อมูลลง Google Sheet ได้
    const url = `${GOOGLE_SCRIPT_URL}?name=${encodeURIComponent(name)}&score=${score}&pass=${pass}&fail=${fail}`;
    fetch(url, { mode: 'no-cors' })
        .then(() => console.log("บันทึกสถิติลง Google Sheet สำเร็จ"))
        .catch(err => console.error("ไม่สามารถบันทึก Google Sheet ได้:", err));
}

function playPassSound() {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    let osc = audioCtx.createOscillator(); let gainNode = audioCtx.createGain();
    osc.connect(gainNode); gainNode.connect(audioCtx.destination);
    osc.type = 'sine'; osc.frequency.setValueAtTime(600, audioCtx.currentTime); 
    osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    osc.start(); osc.stop(audioCtx.currentTime + 0.5);
}

function playFailSound() {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    let osc = audioCtx.createOscillator(); let gainNode = audioCtx.createGain();
    osc.connect(gainNode); gainNode.connect(audioCtx.destination);
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(300, audioCtx.currentTime); 
    osc.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.2);
    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
    osc.start(); osc.stop(audioCtx.currentTime + 0.3);
}

let currentUtterance = null;
function playSentenceAudio() {
    stopSentenceAudio(); 
    if (questions.length === 0 || currentQuestion >= questions.length) return;
    const textToSpeak = questions[currentQuestion].english;
    currentUtterance = new SpeechSynthesisUtterance(textToSpeak);
    currentUtterance.lang = 'en-US'; 
    currentUtterance.rate = 0.85; 
    window.speechSynthesis.speak(currentUtterance);
}

function stopSentenceAudio() {
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel(); 
    }
}