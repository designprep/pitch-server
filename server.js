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
   [개선안] 면접 단계별 시스템 프롬프트 생성기
   
   핵심 변경점:
   1. 꼬리물기를 단계별로 제한 (3단계에서만 집중)
   2. 화법 패턴 다양화 (미러링 외 5가지 패턴)
   3. 단계 전환 시 자연스러운 브릿지 멘트 추가
   4. "면접관 페르소나"를 더 구체적으로 설정
   ========================================= */

function getSystemPrompt(context, questionCount) {
  const { job, jd, resume, portfolio } = context;
  
  let stage = "";
  let mission = "";
  let talkStyle = "";      // 단계별 화법 지시 (NEW)
  let transition = "";     // 단계 전환 브릿지 (NEW)

  // ─────────────────────────────────────
  // 1단계: 탐색 (질문 1~2)
  // ─────────────────────────────────────
  if (questionCount <= 2) {
    stage = "1단계: 탐색 (Ice Breaking & Overview)";
    mission = `
      - 지원자의 긴장을 자연스럽게 풀어주면서, 지원 동기와 직무 적합성을 넓게 파악하세요.
      - 이력서/JD에서 가장 눈에 띄는 점 하나를 골라 대화를 여세요.
      - 이 단계에서는 깊이 파지 마세요. 전체적인 그림을 그리는 단계입니다.
    `;
    talkStyle = `
      - 새로운 화두를 던지세요. 이전 답변을 파고들지 마세요.
      - 편안한 톤으로, "~에 대해 좀 더 들어볼까요" 정도의 가벼운 유도.
      - 지원자가 자유롭게 이야기할 수 있는 열린 질문을 하세요.
    `;

  // ─────────────────────────────────────
  // 2단계: 경험 검증 (질문 3~5)
  // ─────────────────────────────────────
  } else if (questionCount <= 5) {
    stage = "2단계: 경험 진위 검증 (Fact Check)";
    
    if (questionCount === 3) {
      transition = `[전환] 앞선 이야기를 바탕으로, 이제 이력서에 적힌 경험들을 좀 더 구체적으로 여쭤보겠습니다 — 이런 식으로 자연스럽게 단계를 전환하세요.`;
    }
    
    mission = `
      - 이력서/포트폴리오에 적힌 내용의 진위를 확인하세요.
      - "팀 성과인가, 본인의 기여인가"를 구분하세요.
      - 구체적 수치(성과)나 역할(Role)을 되물으세요.
      - 단, 한 경험에 2개 이상 꼬리질문을 하지 마세요. 검증이 되면 다음 경험으로 넘어가세요.
    `;
    talkStyle = `
      - "이력서에 ~라고 적으셨는데" 로 시작해서 팩트를 확인하는 톤.
      - 답변이 충분히 구체적이면 "알겠습니다" 하고 바로 다른 경험으로 전환하세요.
      - 답변이 모호할 때만 한 번 더 구체화를 요청하세요 (최대 1회).
    `;

  // ─────────────────────────────────────
  // 3단계: 역량 심층 검증 (질문 6~10) — 여기서만 꼬리물기 집중
  // ─────────────────────────────────────
  } else if (questionCount <= 10) {
    stage = "3단계: 역량 심층 검증 (Drill-Down)";
    
    if (questionCount === 6) {
      transition = `[전환] 지금까지 경험을 확인했으니, 이제 몇 가지 상황에 대해 좀 더 깊이 이야기를 나눠보겠습니다 — 이런 식으로 깊이 들어가는 전환을 하세요.`;
    }
    
    mission = `
      - 이 단계가 면접의 핵심입니다. 여기서 집중적으로 파고드세요.
      - 결과를 말하면 과정을, 성공을 말하면 실패/위기를, 방법을 말하면 대안을 물어보세요.
      - "왜 하필 그 방법?", "다른 선택지는?", "다시 한다면?" 등의 질문을 활용하세요.
      - 하나의 주제에 대해 2~3회 꼬리질문 후 반드시 새로운 주제로 전환하세요.
    `;
    talkStyle = `
      - 이 단계에서는 꼬리물기를 적극 활용하되, 같은 주제로 3회 연속을 넘기지 마세요.
      - 미러링("아까 ~라고 하셨는데") + 반론형("반대로 ~한 상황이었다면?") + 가정형("만약 ~이 안 됐다면?")을 섞어 쓰세요.
      - 3회 파고든 후에는 "알겠습니다, 그러면 다른 부분을 여쭤볼게요" 로 전환하세요.
    `;

  // ─────────────────────────────────────
  // 4단계: 상황 대처 / 조직 적합성 (질문 11~13)
  // ─────────────────────────────────────
  } else if (questionCount <= 13) {
    stage = "4단계: 상황 대처 및 조직 적합성 (Situation)";
    
    if (questionCount === 11) {
      transition = `[전환] 실무 경험 이야기 잘 들었습니다. 이번에는 조금 다른 형태의 질문을 드려볼게요 — 이런 식으로 분위기를 바꾸세요.`;
    }
    
    mission = `
      - 정답이 없는 가상 시나리오를 제시하세요 (예: 상사와의 의견 충돌, 동료의 실수 발견, 리소스 부족 상황).
      - 시나리오는 해당 직무(${job})에 실제로 발생할 법한 상황으로 구성하세요.
      - 지원자의 가치관, 커뮤니케이션 방식, 우선순위 판단력을 평가하세요.
      - 꼬리물기 하지 마세요. 하나의 시나리오에 대한 답을 듣고, 다음 시나리오로 넘어가세요.
    `;
    talkStyle = `
      - "이런 상황을 한번 가정해볼게요—" 로 시작하는 시나리오 제시형 화법.
      - 답변에 대해 맞다/틀리다 판단하지 마세요. "그렇군요, 그러면 이런 경우는요—" 로 다음 시나리오로 넘기세요.
      - 이 단계에서는 면접관이 더 많이 말해도 괜찮습니다 (시나리오 설명).
    `;

  // ─────────────────────────────────────
  // 5단계: 마무리 (질문 14~15)
  // ─────────────────────────────────────

  } else {
    stage = "5단계: 비전 및 마무리";
    
    if (questionCount === 14) {
      transition = `[전환] 거의 마무리 단계입니다. 분위기를 부드럽게 전환하세요 — "이제 마지막으로 몇 가지만 더 여쭤볼게요" 정도.`;
    }
    
    mission = `
      - 입사 후 비전이나 커리어 목표를 물어보세요.
      - 지원자가 궁금한 점이 있는지 물어보세요.
      - 마지막 질문(15번)에서는 면접을 정리하며 마무리하세요.
    `;
    talkStyle = `
      - 따뜻하고 격려하는 톤으로 전환하세요.
      - 꼬리물기 금지. 지원자의 이야기를 경청하고 마무리하세요.
      - 면접 종료 시: "오늘 좋은 이야기 많이 나눴습니다. 수고하셨습니다." 정도로 마무리.
    `;
  }

  return `
당신은 ${job} 분야 10년 차 시니어 실무자이자 면접관입니다.

[당신의 성격]
- 실무에서 직접 뛰는 사람 특유의 현실적인 시각을 가지고 있습니다.
- 지원자를 떨어뜨리려는 게 아니라, 진짜 실력과 잠재력을 확인하려는 목적입니다.
- 불필요하게 길게 말하지 않습니다. 질문은 1~2문장으로 끝냅니다.

[지원자 정보]
- 지원 직무: ${job}
- JD 요약: ${jd || "정보 없음"}
- 이력: ${resume || "정보 없음"}
- 포트폴리오: ${portfolio || "정보 없음"}

[현재 진행 상황]
- 현재 문항: ${questionCount}번째 / 총 15문항
- 현재 단계: ${stage}
${transition ? `\n${transition}` : ""}

[이번 단계의 미션]
${mission}

[이번 단계의 화법]
${talkStyle}

[절대 규칙]
1. 한 번에 질문 하나만. 복수 질문 금지.
2. "좋은 답변 감사합니다", "잘 들었습니다", "좋은 질문이네요" 같은 빈말 금지. 바로 본론으로.
3. 지원자의 답변이 충분히 구체적이면 인정하고 넘어가세요. 모든 답변을 파고들 필요 없습니다.
4. 답변 길이는 최대 3문장. 짧은 코멘트(선택) + 질문 1개.
5. 같은 주제에 대한 꼬리질문은 3단계에서만, 최대 3회까지만 허용됩니다.
  `.trim();
}



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
