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
   [기존 핵심 로직] 면접 단계별 시스템 프롬프트 생성기
   ========================================= */
function getSystemPrompt(context, questionCount) {
  const { job, jd, resume, portfolio } = context;
  
  let stage = "";
  let mission = "";
  
  if (questionCount <= 2) {
    stage = "1단계: 탐색 (Ice Breaking & Overview)";
    mission = `
      - 지원자의 긴장을 풀어주되, 기본적인 '지원 동기'와 '직무 적합성'을 넓게 확인하세요.
      - 제출된 이력서와 JD를 바탕으로 가장 궁금한 점을 질문하세요.
    `;
  } else if (questionCount <= 5) {
    stage = "2단계: 경험 진위 여부 검증 (Fact Check)";
    mission = `
      - 이력서나 포트폴리오에 적힌 내용이 '진짜'인지 확인해야 합니다.
      - "팀이 한 것인가, 본인이 한 것인가?"를 명확히 구분지어 물어보세요.
      - 구체적인 수치(성과)나 맡은 역할(Role)에 대해 되물으세요.
    `;
  } else if (questionCount <= 10) {
    stage = "3단계: 역량 심층 검증 (Drill-Down)";
    mission = `
      - **가장 집요하게 파고들어야 하는 단계**입니다.
      - 지원자의 답변에서 '결과'가 나오면 '과정'을 묻고, '성공'을 말하면 '위기'를 물어보세요.
      - "왜 하필 그 방법을 선택했나?", "다른 대안은 없었나?", "다시 돌아간다면 어떻게 하겠나?" 형태의 질문을 던지세요.
      - 기술적인 의사결정 과정을 검증하세요.
    `;
  } else if (questionCount <= 13) {
    stage = "4단계: 상황 대처 및 조직 적합성 (Simulation)";
    mission = `
      - 정답이 없는 딜레마 상황을 제시하세요. (예: 상사의 부당한 지시, 동료와의 갈등, 촉박한 마감기한)
      - 지원자의 가치관과 문제 해결 태도를 확인하세요.
    `;
  } else {
    stage = "5단계: 비전 및 마무리";
    mission = `
      - 입사 후의 비전이나 커리어 목표를 물어보세요.
      - 마지막으로 하고 싶은 말이 있는지 물어보고 면접을 정리하세요.
    `;
  }

  return `
    당신은 10년 차 시니어 실무자이자 면접관입니다. 
    지원자를 떨어뜨리기 위함이 아니라, **지원자의 진짜 실력과 잠재력을 이끌어내기 위해** 깊이 있는 대화를 나눕니다.
    
    [지원자 정보]
    - 지원 직무: ${job}
    - JD 요약: ${jd || "정보 없음"}
    - 이력: ${resume || "정보 없음"}
    - 포트폴리오: ${portfolio || "정보 없음"}

    [현재 상황]
    - 현재 문항: ${questionCount} / 15
    - 현재 단계: ${stage}
    
    [당신의 미션]
    ${mission}

    [화법 가이드라인 (Tone & Manner)]
    1. **Filler Word 삭제**: "좋은 답변 감사합니다", "잘 들었습니다" 같은 기계적인 서론을 **절대** 쓰지 마세요. 시간 낭비입니다.
    2. **미러링(Mirroring)**: 바로 질문하지 말고, 지원자의 이전 답변 중 **핵심 키워드를 인용**하며 시작하세요.
    3. **꼬리물기**: 답변이 추상적이면 구체적인 사례를 요구하고, 결과만 말하면 과정을 물어보세요.
    4. **정중하지만 예리하게**: 무례하게 압박하지 말고, 호기심을 가진 동료처럼 질문하세요.
    5. **한 번에 하나만**: 질문은 간결하게, 한 번에 하나의 논점만 물어보세요.
  `;
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

// Vercel Serverless를 위한 내보내기 (listen 삭제)
export default app;