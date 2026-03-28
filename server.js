/* =========================================
   PITCH SERVER - ES MODULE VERSION (FINAL + TOSS LOGIN)
   ========================================= */
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import crypto from 'crypto'; // 암호화/복호화를 위한 기본 내장 모듈

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


/* =========================================
   [NEW] 토스 로그인 관련 설정 및 복호화 함수
   ========================================= */
const TOSS_API_URL = 'https://apps-in-toss-api.toss.im';
const TOSS_DECRYPT_KEY = process.env.TOSS_DECRYPT_KEY; // 이메일로 받은 Base64 인코딩된 AES Key
const TOSS_AAD = process.env.TOSS_AAD;                 // 이메일로 받은 AAD 문자열

/**
 * 토스에서 받은 암호화된 유저 정보를 복호화하는 함수 (공식 문서 Java/PHP 예제 기반)
 */
function decryptTossData(encryptedText) {
  if (!encryptedText || encryptedText === "ENCRYPTED_VALUE") return null;
  if (!TOSS_DECRYPT_KEY || !TOSS_AAD) {
    console.error("환경 변수에 복호화 키(TOSS_DECRYPT_KEY) 또는 AAD가 설정되지 않았습니다.");
    return encryptedText; 
  }

  try {
    const IV_LENGTH = 12;
    const decoded = Buffer.from(encryptedText, 'base64');
    const key = Buffer.from(TOSS_DECRYPT_KEY, 'base64');
    
    const iv = decoded.slice(0, IV_LENGTH);
    const ciphertext = decoded.slice(IV_LENGTH, decoded.length - 16);
    const authTag = decoded.slice(decoded.length - 16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(TOSS_AAD, 'utf8'));

    let decrypted = decipher.update(ciphertext, null, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error("복호화 실패:", error);
    return null;
  }
}

/**
 * [NEW] 토스 로그인 API 엔드포인트
 * 앱(app.js)에서 보낸 '인가 코드'를 받아 토스 서버와 통신 후 최종 유저 정보를 반환합니다.
 */
app.post('/api/toss-login', async (req, res) => {
  const { authorizationCode, referrer } = req.body;

  if (!authorizationCode) {
    return res.status(400).json({ error: true, message: "인가 코드가 없습니다." });
  }

  try {
    // 1. 인가 코드로 Access Token 발급 받기
    const tokenResponse = await fetch(`${TOSS_API_URL}/api-partner/v1/apps-in-toss/user/oauth2/generate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorizationCode, referrer: referrer || 'DEFAULT' })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.resultType !== 'SUCCESS') {
      console.error("토큰 발급 실패:", tokenData);
      return res.status(400).json({ error: true, message: "토큰 발급에 실패했습니다.", details: tokenData });
    }

    const accessToken = tokenData.success.accessToken;

    // 2. Access Token으로 유저 정보(암호화 상태) 조회하기
    const userResponse = await fetch(`${TOSS_API_URL}/api-partner/v1/apps-in-toss/user/oauth2/login-me`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const userData = await userResponse.json();

    if (userData.resultType !== 'SUCCESS') {
      console.error("유저 정보 조회 실패:", userData);
      return res.status(400).json({ error: true, message: "유저 정보 조회에 실패했습니다.", details: userData });
    }

    const encryptedUser = userData.success;

    // 3. 민감한 정보(이름, 이메일 등) 복호화
    const decryptedUser = {
      userKey: encryptedUser.userKey,
      scope: encryptedUser.scope,
      agreedTerms: encryptedUser.agreedTerms,
      name: encryptedUser.name ? decryptTossData(encryptedUser.name) : null,
      email: encryptedUser.email ? decryptTossData(encryptedUser.email) : null,
      gender: encryptedUser.gender ? decryptTossData(encryptedUser.gender) : null,
      // 필요한 정보가 더 있다면 콘솔 설정에 맞춰 이 부분에 추가
    };

    // 4. 프론트엔드로 복호화된 깨끗한 정보 전달
    res.json({
      success: true,
      user: decryptedUser,
      message: "로그인 및 복호화 성공"
    });

  } catch (error) {
    console.error("토스 로그인 처리 중 서버 에러:", error);
    res.status(500).json({ error: true, message: "서버 내부 오류가 발생했습니다." });
  }
});


/* =========================================
   [NEW] 디프렙 7일권 코드 검증 시스템 (50개 세팅 완료)
   ========================================= */
const validCodes = [
  'DP7-A1B2C', 'DP7-X9Y8Z', 'DP7-M4N5P', 'DP7-Q2W3E', 'DP7-R6T7Y',
  'DP7-U8I9O', 'DP7-P0A1S', 'DP7-D2F3G', 'DP7-H4J5K', 'DP7-L6Z7X',
  'DP7-C8V9B', 'DP7-N0M1Q', 'DP7-W2E3R', 'DP7-T4Y5U', 'DP7-I6O7P',
  'DP7-A8S9D', 'DP7-F0G1H', 'DP7-J2K3L', 'DP7-Z4X5C', 'DP7-V6B7N',
  'DP7-M8Q9W', 'DP7-E0R1T', 'DP7-Y2U3I', 'DP7-O4P5A', 'DP7-S6D7F',
  'DP7-G8H9J', 'DP7-K0L1Z', 'DP7-X2C3V', 'DP7-B4N5M', 'DP7-Q6W7E',
  'DP7-R8T9Y', 'DP7-U0I1O', 'DP7-P2A3S', 'DP7-D4F5G', 'DP7-H6J7K',
  'DP7-L8Z9X', 'DP7-C0V1B', 'DP7-N2M3Q', 'DP7-W4E5R', 'DP7-T6Y7U',
  'DP7-I8O9P', 'DP7-A0S1D', 'DP7-F2G3H', 'DP7-J4K5L', 'DP7-Z6X7C',
  'DP7-V8B9N', 'DP7-M0Q1W', 'DP7-E2R3T', 'DP7-Y4U5I', 'DP7-O6P7A'
];

// 한 번 사용된 코드를 저장하여 돌려쓰기(어뷰징) 방지
let usedCodes = []; 

app.post('/api/verify-code', (req, res) => {
  const { code, userKey } = req.body;
  
  if (!validCodes.includes(code)) {
    return res.json({ success: false, message: "유효하지 않은 코드입니다. 코드를 다시 확인해 주세요." });
  }
  
  if (usedCodes.includes(code)) {
    return res.json({ success: false, message: "이미 사용 완료된 코드입니다. 원장님께 새 코드를 문의해 주세요." });
  }
  
  // 정상 코드 확인 완료 -> 사용 처리 후 성공 응답
  usedCodes.push(code);
  res.json({ success: true });
});



/* =========================================
   [개선안 v3.1] 면접 시스템 프롬프트 생성기
   
   피드백 반영:
   1. 0번째 턴(인사)과 1번째 턴(첫 질문)을 자연스럽게 하나로 통합
   2. 오프닝 패턴을 JS 레벨에서 랜덤 선택하여 할루시네이션 방지
   3. 모듈 에러 유발 코드 제거
   ========================================= */

function getSystemPrompt(context, questionCount) {
  const { job, jd, resume, portfolio } = context;
  
  const hasResume = resume && resume.trim() !== "" && resume.trim() !== "정보 없음";
  const hasPortfolio = portfolio && portfolio.trim() !== "" && portfolio.trim() !== "정보 없음";
  const hasJD = jd && jd.trim() !== "" && jd.trim() !== "정보 없음";

  // ─────────────────────────────────────
  // 질문 소스 지시문 (원장님 로직 그대로 유지)
  // ─────────────────────────────────────
  let questionSource = "";
  if (hasJD && hasResume) {
    questionSource = `[질문 생성 규칙]\n- JD 요구역량과 이력서 경험을 연결지어 질문하세요.\n- 없는 경험을 지어내서 묻지 마세요.`;
  } else if (hasJD && !hasResume) {
    questionSource = `[질문 생성 규칙]\n- 이력서가 없으므로 JD에 근거해서만 질문하세요.\n- "이력서에~" 표현 절대 금지.`;
  } else if (!hasJD && hasResume) {
    questionSource = `[질문 생성 규칙]\n- JD가 없으므로 이력서 내용을 기반으로 ${job} 역량과 연결해 질문하세요.`;
  } else {
    questionSource = `[질문 생성 규칙]\n- 제출된 서류가 없습니다. ${job} 직무의 일반적 역량을 열린 질문으로 물어보세요.\n- "이력서에~" 표현 절대 금지.`;
  }

  // ─────────────────────────────────────
  // 단계별 미션/화법/전환
  // ─────────────────────────────────────
  let stage = "";
  let mission = "";
  let talkStyle = "";
  let transition = "";

  // ── 1단계: 인사 및 첫 탐색 (질문 1~2) ──
  if (questionCount <= 2) {
    stage = "1단계: 탐색 (Ice Breaking)";
    
    // 💡 [개선] JS에서 랜덤으로 오프닝 패턴 1개를 뽑아 AI에게 확정 지시
    if (questionCount === 1) {
      const openingPatterns = [
        `맥락형: "${job} 분야가 요즘 ~한 흐름인데, 이 시점에 이 직무에 관심을 갖게 된 계기가 궁금합니다."`,
        `근황형: "요즘 어떤 일을 하고 계세요? 그리고 그게 이 직무와 어떻게 연결되는지 말씀해 주세요."`,
        `직무 이해형: "본인이 생각하는 ${job}의 핵심 역할이 뭐라고 생각하세요?"`
      ];
      if (hasResume) openingPatterns.push(`경험 호기심형: "이력서를 보니 ~한 경험이 눈에 띄는데, 간단히 소개해 주시겠어요?"`);
      if (hasJD) openingPatterns.push(`JD 기반형: JD의 핵심 요구사항 1가지를 언급하며 "이 부분에 대해 어떤 경험이나 생각이 있으신가요?"`);
      
      const selectedPattern = openingPatterns[Math.floor(Math.random() * openingPatterns.length)];
      
      mission = `- 가벼운 면접 시작 인사("안녕하세요, 반갑습니다. 면접을 시작하겠습니다.")와 함께 첫 질문을 건네세요.\n- 지원 동기와 직무 적합성을 넓게 파악하세요.`;
      talkStyle = `- 인사는 짧고 따뜻하게 하세요.\n- 첫 질문은 반드시 다음 패턴을 변형하여 질문하세요:\n  [선택된 패턴: ${selectedPattern}]`;
    } else {
      mission = `- 지원자의 이전 답변을 바탕으로 넓게 탐색을 이어가세요. 깊게 파고들지 마세요.`;
      talkStyle = `- 편안한 톤으로 열린 질문을 하세요.`;
    }

  // ── 2단계: 경험 검증 (질문 3~4) ──
  } else if (questionCount <= 4) {
    stage = "2단계: 경험 검증 (Fact Check)";
    if (questionCount === 3) transition = `[전환] "앞선 이야기를 바탕으로, 경험을 좀 더 구체적으로 여쭤보겠습니다."`;
    mission = `${hasResume ? "- 이력서 경험의 진위를 확인하세요 (팀 성과/본인 기여)." : "- 지원자가 방금 전 언급한 경험에 대해서만 물어보세요."}\n- 한 경험에 꼬리질문 최대 1회.`;
    talkStyle = `${hasResume ? '- "이력서에 ~라고 적으셨는데"로 시작.' : '- "아까 ~라고 하셨는데"로 시작.'}`;

  // ── 3단계: 심층 검증 (질문 5~7) ──
  } else if (questionCount <= 7) {
    stage = "3단계: 역량 심층 검증 (Drill-Down)";
    if (questionCount === 5) transition = `[전환] "이제 몇 가지 상황에 대해 좀 더 깊이 이야기를 나눠보겠습니다."`;
    mission = `- 면접의 핵심 구간입니다. 결과→과정, 성공→위기, 방법→대안을 파고드세요.\n- 주제 당 2~3회 꼬리질문 후 새 주제로 전환.`;
    talkStyle = `- 미러링, 반론("반대였다면?"), 가정("안됐다면?") 활용.`;

  // ── 4단계: 상황 대처 (질문 8~9) ──
  } else if (questionCount <= 9) {
    stage = "4단계: 상황 대처 (Situation)";
    if (questionCount === 8) transition = `[전환] "실무 이야기 잘 들었습니다. 이번에는 가상 시나리오를 하나 드릴게요."`;
    mission = `- 정답 없는 가상 시나리오(갈등, 리소스 부족 등) 제시.\n- 꼬리물기 금지.`;
    talkStyle = `- "이런 상황을 가정해볼게요—" 로 시작. 판단하지 말고 넘기세요.`;

  // ── 5단계: 마무리 (질문 10) ──
  } else {
    stage = "5단계: 마무리";
    transition = `[전환] "마지막 질문입니다."`;
    mission = `- 입사 후 비전이나 커리어 목표 질문.\n- 지원자 답변 후 면접을 마무리하세요.`;
    talkStyle = `- 따뜻한 톤. 꼬리물기 금지.\n- 종료 인사: "수고하셨습니다. 곧 결과를 분석해 드리겠습니다."`;
  }

  return `
당신은 ${job} 분야 10년 차 시니어 실무자이자 면접관입니다.

[당신의 성격]
- 실무에서 직접 뛰는 사람 특유의 현실적인 시각을 가지고 있습니다.
- 지원자를 떨어뜨리려는 게 아니라, 진짜 실력과 잠재력을 확인하려는 목적입니다.

[지원자 정보]
- 지원 직무: ${job}
${hasJD ? `- JD(채용공고):\n${jd}` : "- JD: 없음"}
${hasResume ? `- 이력서:\n${resume}` : "- 이력서: 없음"}

${questionSource}

[현재 진행 상황]
- 현재: ${questionCount}번째 질문 / 총 10문항
- 현재 단계: ${stage}
${transition ? `\n${transition}` : ""}

[이번 단계의 미션]
${mission}

[이번 단계의 화법]
${talkStyle}

[절대 규칙]
1. 한 번에 질문 하나만. 짧은 코멘트 + 질문 1개.
2. 빈말("좋은 답변 감사합니다") 금지.
3. 제출되지 않은 자료의 내용을 지어내서 질문하지 마세요 (할루시네이션 절대 금지).
4. 지원자가 말한 적 없는 내용을 인용하지 마세요.
  `.trim();
}
// 💡 모듈 내보내기 삭제됨


/* =========================================
   [기존 핵심 로직] AI 통신 라우터 (채팅 & 리포트)
   ========================================= */
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, type, job, jd, resume, portfolio } = req.body;

    const userMsgCount = messages.filter(m => m.role === 'user').length;
    const questionCount = userMsgCount + 1;

    // A. 면접 진행 (INTERVIEW)
    if (type === 'interview') {
      if (questionCount > 15) {
        return res.json({ 
          nextQuestion: "긴 시간 동안 고생 많으셨습니다. 면접을 모두 마치겠습니다. 잠시만 기다려 주시면 면접 내용을 분석해 드리겠습니다.",
          isFinished: true 
        });
      }

      const systemPrompt = getSystemPrompt({ job, jd, resume, portfolio }, questionCount);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o", 
        messages: [
          { role: "system", content: systemPrompt },
          ...messages 
        ],
        temperature: 0.7, 
        max_tokens: 350
      });

      const aiResponse = completion.choices[0].message.content;
      
      let feedback = null;
      const lastUserMsg = messages[messages.length - 1]?.content || "";
      if (lastUserMsg.length < 10) {
        feedback = "답변이 너무 짧습니다. 구체적인 사례를 들어 설명해 주십시오.";
      }

      res.json({ 
        nextQuestion: aiResponse, 
        feedback: feedback,
        currentCount: questionCount,
        totalCount: 15
      });
    } 
    
    // B. 리포트 생성 (REPORT)
    else if (type === 'report') {
      const userMessages = messages.filter(m => m.role === 'user');
      const totalUserText = userMessages.map(m => m.content).join(" ");
      
      if (totalUserText.length < 30) {
        return res.json({
          grade: "F",
          summary: "답변이 너무 부족하여 분석할 수 없습니다. 침묵은 면접에서 가장 큰 감점 요인입니다.",
          keyword_gap: { used: [], missing: ["기본 답변", "적극성"] },
          feedback_points: [],
          scores: { fit:0, logic:0, tech:0, confidence:0, ethics:0 }
        });
      }

      const reportPrompt = `
        당신은 "AI 면접 정밀 분석관"입니다. 
        지원자의 답변을 분석하여, 합격에 필요한 [데이터 기반 피드백]을 JSON으로 작성하세요.
        
        [분석 목표]
        1. **Keyword Gap:** 지원 직무(${job})와 JD(${jd || "일반적인 직무 요구사항"})에서 중요한 키워드 5개를 뽑고, 지원자가 답변에서 실제 사용했는지 체크하세요.
        2. **Red Pen (첨삭):** 지원자의 답변 중 **가장 좋았던 문장(Best)**과 **가장 안 좋았던 문장(Worst)**을 원문 그대로 인용하고, 이유를 설명하세요.
        
        [출력 JSON 형식]
        {
          "grade": "S/A/B/C/F",
          "summary": "전체 총평 (200자 내외)",
          "scores": { "fit": 0~10, "logic": 0~10, "tech": 0~10, "confidence": 0~10, "ethics": 0~10 },
          
          "keyword_gap": {
            "jd_needs": ["데이터", "협업", "Figma", "기획", "문제해결"],
            "user_said": ["협업", "기획"],
            "missing": ["데이터", "Figma", "문제해결"]
          },
          
          "feedback_points": [
            {
              "type": "bad",
              "quote": "그냥 열심히 노력해서 해결했습니다.",
              "advice": "'그냥', '열심히'는 모호합니다. 구체적인 방법(How)을 설명해야 합니다."
            },
            {
              "type": "good",
              "quote": "전년 대비 매출을 20% 성장시켰습니다.",
              "advice": "구체적인 수치(20%)를 제시하여 성과를 명확히 증명했습니다."
            }
          ]
        }
      `;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: reportPrompt },
          ...messages
        ],
        response_format: { type: "json_object" }
      });

      const reportData = JSON.parse(completion.choices[0].message.content);
      res.json(reportData);
    }

  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: true, message: "AI 서버 통신 중 오류가 발생했습니다." });
  }
});


// (위쪽은 기존 /api/chat 라우터 코드...)

/* =========================================
   [NEW] OpenAI TTS (고품질 음성 합성) API
   ========================================= */
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: true, message: "텍스트가 없습니다." });
    }

    // OpenAI TTS API 호출 (가장 가성비가 좋은 tts-1 모델 사용)
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: "onyx", // 묵직하고 차분한 남성 시니어 톤 (여성 톤: 'nova')
      input: text,
    });

    // 오디오 데이터를 버퍼로 변환하여 클라이언트(앱)로 전송
    const buffer = Buffer.from(await mp3.arrayBuffer());
    res.set({ 'Content-Type': 'audio/mpeg' });
    res.send(buffer);

  } catch (error) {
    console.error("TTS API 에러:", error);
    res.status(500).json({ error: true, message: "음성 생성에 실패했습니다." });
  }
});

// Vercel Serverless를 위한 내보내기 (listen 삭제)
export default app;
