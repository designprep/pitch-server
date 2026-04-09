/* =========================================
   PITCH SERVER - ES MODULE VERSION (FINAL + TOSS LOGIN)
   ========================================= */
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import crypto from 'crypto'; // 암호화/복호화를 위한 기본 내장 모듈
import admin from 'firebase-admin';
import axios from 'axios';

// 파이어베이스 초기화 (중복 초기화 방지)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel에서 줄바꿈 문자가 깨지는 현상을 방지하기 위한 처리
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}
const db = admin.firestore(); // 이제 'db' 변수로 데이터베이스를 마음껏 조작할 수 있습니다!
// 💡 파이어베이스 db 선언부 아래에 추가해 주세요.
async function getOrCreateUserTicket(userKey) {
  const userRef = db.collection('users').doc(userKey);
  const doc = await userRef.get();

  if (!doc.exists) {
    // 신규 유저라면 기본 티켓 2장 지급
    await userRef.set({
      tickets: 2,
      lastLogin: new Date().toISOString()
    });
    return 2;
  } else {
    // 기존 유저라면 DB에 있는 티켓 수 반환
    return doc.data().tickets;
  }
}



dotenv.config();

const app = express();
app.use(cors());
// 이미지 데이터를 처리할 수 있도록 용량 제한을 10MB로 늘립니다.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

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
    // 1. 인가 코드로 Access Token 발급 받기 (axios 버전)
    const tokenResponse = await axios.post(`${TOSS_API_URL}/api-partner/v1/apps-in-toss/user/oauth2/generate-token`, 
      { authorizationCode, referrer: referrer || 'DEFAULT' },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const tokenData = tokenResponse.data;

    if (tokenData.resultType !== 'SUCCESS') {
      console.error("토큰 발급 실패:", tokenData);
      return res.status(400).json({ error: true, message: "토큰 발급에 실패했습니다.", details: tokenData });
    }

    const accessToken = tokenData.success.accessToken;

    // 2. Access Token으로 유저 정보 조회하기 (axios 버전)
    const userResponse = await axios.get(`${TOSS_API_URL}/api-partner/v1/apps-in-toss/user/oauth2/login-me`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });
    const userData = userResponse.data;

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

// 💡 [추가된 부분!] 파이어베이스에서 티켓 정보를 가져와서 user 객체에 합칩니다.
    try {
      const currentTickets = await getOrCreateUserTicket(decryptedUser.userKey);
      decryptedUser.tickets = currentTickets; 
    } catch (dbError) {
      console.error("Firebase 티켓 조회 에러:", dbError);
      decryptedUser.tickets = 0; // 에러 시 일단 0처리 (앱 뻗음 방지)
    }

    // 4. 프론트엔드로 복호화된 깨끗한 정보 + 티켓 개수 전달
    res.json({
      success: true,
      user: decryptedUser,
      message: "로그인 및 복호화, 티켓 조회 성공"
    });

} catch (error) {
    console.error("토스 로그인 처리 중 서버 에러:", error);
    res.status(500).json({ 
        error: true, 
        message: "서버 내부 오류가 발생했습니다.",
        details: error.message || error.toString() // 💡 추가됨: 진짜 자바스크립트 에러 내용 출력
    });
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

app.post('/api/verify-code', async (req, res) => {
  const { code, userKey } = req.body;
  
  // 1. 유효한 형식의 코드인지 먼저 확인
  if (!validCodes.includes(code)) {
    return res.json({ success: false, message: "유효하지 않은 코드입니다. 코드를 다시 확인해 주세요." });
  }
  
  try {
    // 2. 파이어베이스 'used_codes' 컬렉션에서 해당 코드가 있는지 조회
    const codeRef = db.collection('used_codes').doc(code);
    const codeDoc = await codeRef.get();

    // 3. 이미 DB에 문서가 존재한다면 누군가 쓴 것임!
    if (codeDoc.exists) {
      return res.json({ success: false, message: "이미 사용 완료된 코드입니다. 원장님께 새 코드를 문의해 주세요." });
    }

    // 4. 통과! -> DB에 '이 코드는 이 유저가 썼음'이라고 영구 기록 박제
    await codeRef.set({
      usedBy: userKey,
      usedAt: new Date().toISOString()
    });

    // 5. 💡 [핵심] 코드를 입력한 유저의 파이어베이스 DB에 티켓 10장(예시)을 더해줍니다!
    const userRef = db.collection('users').doc(userKey);
    await userRef.update({
      tickets: admin.firestore.FieldValue.increment(10) // 10회권이라면 10을 입력. 필요에 따라 수정하세요!
    });

    res.json({ success: true, message: "티켓 충전이 완료되었습니다!" });

  } catch (error) {
    console.error("코드 검증 및 충전 중 서버 에러:", error);
    res.status(500).json({ success: false, message: "서버 내부 오류가 발생했습니다." });
  }
});



/* =========================================
   [개선안 v3.4] 면접 시스템 프롬프트 생성기 (최종 마스터 버전)
   ========================================= */

function getSystemPrompt(context, questionCount) {
  const { job, jd, resume, portfolio } = context;
  
  const hasResume = resume && resume.trim() !== "" && resume.trim() !== "정보 없음";
  const hasPortfolio = portfolio && portfolio.trim() !== "" && portfolio.trim() !== "정보 없음";
  const hasJD = jd && jd.trim() !== "" && jd.trim() !== "정보 없음";

  // ─────────────────────────────────────
  // 질문 소스 지시문
  // ─────────────────────────────────────
  let questionSource = "";
  if (hasJD && (hasResume || hasPortfolio)) {
    questionSource = `[질문 생성 규칙]\n- <채용공고>의 요구역량과 <지원자_이력서/포트폴리오>의 경험을 연결지어 질문하세요.`;
  } else if (hasJD && !hasResume && !hasPortfolio) {
    questionSource = `[질문 생성 규칙]\n- 제출된 이력이나 경험이 없으므로 <채용공고>에 근거해서 직무 이해도 위주로 질문하세요.`;
  } else if (!hasJD && (hasResume || hasPortfolio)) {
    questionSource = `[질문 생성 규칙]\n- 채용공고가 없으므로 제출된 서류를 기반으로 ${job} 역량과 연결해 질문하세요.`;
  } else {
    questionSource = `[질문 생성 규칙]\n- 제출된 서류가 없습니다. ${job} 직무의 일반적 역량을 열린 질문이나 상황 대처 질문으로 물어보세요.`;
  }

  // ─────────────────────────────────────
  // 단계별 미션/화법/전환
  // ─────────────────────────────────────
  let stage = "";
  let mission = "";
  let talkStyle = "";
  let transition = "";

  if (questionCount <= 2) {
    stage = "1단계: 탐색 (Ice Breaking)";
    if (questionCount === 1) {
      const openingPatterns = [
        // 💡 [클로드 피드백 3 반영] 할루시네이션 유발하는 '업계 흐름' 제거, 안전한 동기 질문으로 수정
        `기본 동기형: "여러 직무 중 특별히 ${job} 직무에 지원하게 된 계기가 무엇인지 궁금합니다."`,
        `근황형: "요즘 어떤 일을 하고 계세요? 그리고 그게 이 직무와 어떻게 연결되는지 말씀해 주세요."`,
        `직무 이해형: "본인이 생각하는 ${job}의 핵심 역할이 뭐라고 생각하세요?"`
      ];
      if (hasResume || hasPortfolio) openingPatterns.push(`경험 호기심형: "제출해주신 서류를 보니 ~한 경험이 눈에 띄는데, 간단히 소개해 주시겠어요?"`);
      if (hasJD) openingPatterns.push(`JD 기반형: 채용공고의 핵심 요구사항 1가지를 언급하며 "이 부분에 대해 어떤 생각이나 대비가 되어 있으신가요?"`);
      
      const selectedPattern = openingPatterns[Math.floor(Math.random() * openingPatterns.length)];
      
      mission = `- 가벼운 인사("안녕하세요, 반갑습니다. 오늘 편하게 이야기 나눠보겠습니다.")와 함께 첫 질문을 건네세요.\n- 지원 동기와 직무 적합성을 넓게 파악하세요.`;
      talkStyle = `- 인사는 짧고 따뜻하게 하세요.\n- 첫 질문은 반드시 다음 패턴을 변형하여 질문하세요:\n  [선택된 패턴: ${selectedPattern}]`;
    } else {
      mission = `- 지원자의 이전 답변을 바탕으로 넓게 탐색을 이어가세요. 깊게 파고들지 마세요.`;
      talkStyle = `- 편안한 톤으로 열린 질문을 하세요.`;
    }
  } else if (questionCount <= 4) {
    stage = "2단계: 경험 검증 (Fact Check)";
    if (questionCount === 3) transition = `[전환] "앞선 이야기를 바탕으로 좀 더 구체적으로 여쭤보겠습니다."`;
    mission = `지원자가 방금 전 언급한 내용이나 서류에 기재된 내용에 대해 구체적인 사실 관계(역할, 기여도 등)를 확인하세요.\n- 한 주제에 꼬리질문 최대 1회.`;
    talkStyle = (hasResume || hasPortfolio) 
      ? `- "서류에 적어주신 내용 중" 또는 "방금 ~라고 하셨는데"로 시작하세요.`
      : `- "방금 ~라고 하셨는데"로 시작하세요. (※ 서류 관련 표현 절대 금지)`;
  } else if (questionCount <= 7) {
    stage = "3단계: 역량 심층 검증 (Drill-Down)";
    if (questionCount === 5) transition = `[전환] "이제 몇 가지 상황에 대해 좀 더 깊이 이야기를 나눠보겠습니다."`;
    let stage3Mission = `- 면접의 핵심 구간입니다. 결과→과정, 성공→위기, 방법→대안을 파고드세요.\n- 주제 당 2~3회 꼬리질문 후 새 주제로 전환하세요.`;
    if (hasJD) stage3Mission += `\n- 새 주제로 전환할 때는 <채용공고>에서 아직 검증하지 않은 요구역량으로 넘어가세요.`;
    mission = stage3Mission;
    talkStyle = `- 미러링, 반론("반대였다면?"), 가정("안됐다면?") 활용.`;
  } else if (questionCount <= 9) {
    stage = "4단계: 상황 대처 (Situation)";
    if (questionCount === 8) transition = `[전환] "실무 이야기 잘 들었습니다. 이번에는 가상 시나리오를 하나 드릴게요."`;
    mission = `- 정답 없는 가상 시나리오(갈등, 리소스 부족 등) 제시.\n- 꼬리물기 금지.`;
    talkStyle = `- "이런 상황을 가정해볼게요—" 로 시작. 판단하지 말고 넘기세요.`;
  } else {
    stage = "5단계: 마무리";
    transition = `[전환] "마지막 질문입니다."`;
    mission = `- 입사 후 비전이나 커리어 목표 질문.\n- 지원자 답변 후 면접을 마무리하세요.`;
    talkStyle = `- 따뜻한 톤. 꼬리물기 금지.\n- 종료 인사: "오늘 좋은 이야기 많이 나눴습니다. 수고하셨습니다. 잠시 기다려주시면 결과를 분석해 드리겠습니다."`;
  }

  return `
당신은 ${job} 분야 10년 차 시니어 실무자이자 면접관입니다.

[당신의 성격]
- 실무에서 직접 뛰는 사람 특유의 현실적인 시각을 가지고 있습니다.
- 지원자를 떨어뜨리려는 게 아니라, 진짜 실력과 잠재력을 확인하려는 목적입니다.

[지원자 데이터]
<채용공고>
${hasJD ? jd : "입력된 공고 없음"}
</채용공고>

<지원자_이력서>
${hasResume ? resume : "입력된 이력서 없음"}
</지원자_이력서>

<지원자_포트폴리오>
${hasPortfolio ? portfolio : "입력된 포트폴리오/프로젝트 없음"}
</지원자_포트폴리오>

${questionSource}

[현재 진행 상황]
- 현재: ${questionCount}번째 질문 / 총 10문항
- 현재 단계: ${stage}
${transition ? `\n${transition}` : ""}

[이번 단계의 미션]
${mission}

[이번 단계의 화법]
${talkStyle}

[🚫 절대 규칙 - 할루시네이션 및 과장 엄격 금지]
1. [치명적 중요] <채용공고>의 내용은 회사가 원하는 조건일 뿐입니다. 이를 지원자의 '과거 본인 경험'이라고 절대 착각하여 질문하지 마십시오.
2. [치명적 중요] <지원자_이력서>나 <지원자_포트폴리오>가 '없음'인 경우, 지원자는 경험을 제출하지 않은 것입니다. 없는 경험을 지어내어 묻지 마십시오.
3. 지원자가 방금 전 말한 적 없는 내용을 마음대로 인용하여 질문하지 마십시오.
4. [꼬리질문 규칙] 같은 주제를 파고드는 꼬리질문은 '3단계'에서만 허용되며, 1·2·4·5단계에서는 절대 금지합니다.
5. 한 번에 질문 하나만 하세요. 전체 응답은 최대 3문장(짧은 코멘트 1문장 + 질문 1문장)으로 제한합니다. (해설자처럼 길게 말하지 마세요)
6. 빈말("좋은 답변 감사합니다", "훌륭합니다" 등)을 금지합니다.
  `.trim();
}


/* =========================================
   [NEW] OpenAI Vision API (이미지 텍스트 추출/OCR)
   ========================================= */
app.post('/api/extract-text', async (req, res) => {
  try {
    const { imageBase64 } = req.body; // 프론트엔드에서data:image/jpeg;base64,... 형식으로 보냄

    if (!imageBase64) {
      return res.status(400).json({ error: true, message: "이미지 데이터가 없습니다." });
    }

    console.log("📸 [Vision] JD 이미지 분석 시작...");

    // OpenAI Chat Completions API 호출 (모델은 gpt-4o 필수)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o", // 이미지를 볼 수 있는 모델
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "이 이미지 속에 적힌 채용공고 내용을 지원자 면접에 활용할 수 있도록, 가독성 좋게 텍스트로만 추출해 주세요. 부가 설명 없이 추출된 텍스트 내용만 딱 반환하세요." },
            {
              type: "image_url",
              image_url: {
                url: imageBase64, // Base64 이미지 데이터를 직접 전달
              },
            },
          ],
        },
      ],
      max_tokens: 1500, // 공고 내용이 길 수 있으므로 충분히 설정
    });

    const extractedText = completion.choices[0].message.content;
    
    console.log("✅ [Vision] 텍스트 추출 완료 (길이:", extractedText.length, ")");
    
    res.json({ success: true, text: extractedText });

  } catch (error) {
    console.error("❌ OCR API 에러:", error);
    res.status(500).json({ error: true, message: "AI가 이미지를 분석하는 중에 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." });
  }
});

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
      const { growthData } = req.body; 

      const userMessages = messages.filter(m => m.role === 'user');
      
      // 💡 [핵심 수정] 앱이 자동 전송한 '첫 인사말'은 글자 수 계산에서 제외합니다!
      const realUserMessages = userMessages.filter(m => !m.content.includes("제출한 서류를 바탕으로 면접을 시작해주세요"));
      const totalUserText = realUserMessages.map(m => m.content).join(" ");
      
      // 실제 답변이 15자 미만이면 AI 안 돌리고 즉시 F등급 (무한 로딩 원천 차단)
      if (totalUserText.length < 15) {
        return res.json({
          grade: "F",
          summary: "실제 답변 데이터가 너무 부족하여 분석할 수 없습니다. 침묵이나 지나치게 짧은 답변은 면접에서 가장 큰 감점 요인입니다.",
          keyword_gap: { jd_needs: [], user_said: [], missing: ["성의 있는 답변", "적극성"] },
          feedback_points: [],
          scores: { fit:0, logic:0, tech:0, confidence:0, ethics:0 },
          growth: { hasGrowth: false }
        });
      }
      // 💡 [NEW] 성장 추적 프롬프트 동적 생성
      let growthPrompt = "";
      let hasGrowth = false;
      if (growthData && growthData.past && growthData.current) {
        hasGrowth = true;
        growthPrompt = `
        3. **Growth Tracking (성장 추적):** 지원자의 [과거 답변]과 [오늘 답변]을 비교하여 얼마나 발전했는지 분석하세요.
           - 과거 답변: "${growthData.past}"
           - 오늘 답변: "${growthData.current}"
           - 발전된 부분(구체성, 논리성, 수치 추가 등)을 1~2문장으로 요약하고, 오늘 답변 중 가장 좋아진 핵심 구절 양옆에 <mark> 태그를 달아주세요.
        `;
      }

      const reportPrompt = `
        당신은 "AI 면접 정밀 분석관"입니다. 
        지원자의 답변을 분석하여, 합격에 필요한 [데이터 기반 피드백]을 JSON으로 작성하세요.
        
        [분석 목표]
        1. **Keyword Gap:** 지원 직무(${job})와 JD에서 중요한 키워드 5개를 뽑고, 사용 여부를 체크하세요.
        2. **Red Pen (첨삭):** 답변 중 가장 좋았던 문장과 안 좋았던 문장을 인용하고 조언하세요.
        ${growthPrompt}
        
        [출력 JSON 형식]
        {
          "grade": "S/A/B/C/F",
          "summary": "전체 총평 (200자 내외)",
          "scores": { "fit": 0~10, "logic": 0~10, "tech": 0~10, "confidence": 0~10, "ethics": 0~10 },
          
          "keyword_gap": { "jd_needs": [], "user_said": [], "missing": [] },
          "feedback_points": [ { "type": "bad", "quote": "...", "advice": "..." } ],
          
          "growth": {
            "hasGrowth": ${hasGrowth},
            "summaryText": "이전 면접보다 구체적인 수치 데이터가 추가되어 답변의 신뢰도가 크게 상승했습니다.",
            "pastText": "과거 답변 원문 텍스트",
            "todayText": "오늘 답변 중 <mark>강조할 부분</mark>이 포함된 텍스트"
          }
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
