/* =========================================
   PITCH SERVER - ES MODULE VERSION (FINAL)
   ========================================= */
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * [핵심] 면접 단계별 시스템 프롬프트 생성기
 * 현재 질문 횟수(count)에 따라 AI의 행동 지침(Persona)을 갈아 끼웁니다.
 */
function getSystemPrompt(context, questionCount) {
  const { job, jd, resume, portfolio } = context;
  
  // 1. 현재 스테이지 정의 (The 5-Stage Funnel)
  let stage = "";
  let mission = "";
  
  if (questionCount <= 2) {
    // Stage 1: 오프닝 & 탐색
    stage = "1단계: 탐색 (Ice Breaking & Overview)";
    mission = `
      - 지원자의 긴장을 풀어주되, 기본적인 '지원 동기'와 '직무 적합성'을 넓게 확인하세요.
      - 제출된 이력서와 JD를 바탕으로 가장 궁금한 점을 질문하세요.
    `;
  } else if (questionCount <= 5) {
    // Stage 2: 사실 검증 (Fact Check)
    stage = "2단계: 경험 진위 여부 검증 (Fact Check)";
    mission = `
      - 이력서나 포트폴리오에 적힌 내용이 '진짜'인지 확인해야 합니다.
      - "팀이 한 것인가, 본인이 한 것인가?"를 명확히 구분지어 물어보세요.
      - 구체적인 수치(성과)나 맡은 역할(Role)에 대해 되물으세요.
    `;
  } else if (questionCount <= 10) {
    // Stage 3: 심층 딥다이브 (Deep Dive) - 가장 중요한 구간!
    stage = "3단계: 역량 심층 검증 (Drill-Down)";
    mission = `
      - **가장 집요하게 파고들어야 하는 단계**입니다.
      - 지원자의 답변에서 '결과'가 나오면 '과정'을 묻고, '성공'을 말하면 '위기'를 물어보세요.
      - "왜 하필 그 방법을 선택했나?", "다른 대안은 없었나?", "다시 돌아간다면 어떻게 하겠나?" 형태의 질문을 던지세요.
      - 기술적인 의사결정 과정을 검증하세요.
    `;
  } else if (questionCount <= 13) {
    // Stage 4: 상황 대처 & 컬처핏
    stage = "4단계: 상황 대처 및 조직 적합성 (Simulation)";
    mission = `
      - 정답이 없는 딜레마 상황을 제시하세요. (예: 상사의 부당한 지시, 동료와의 갈등, 촉박한 마감기한)
      - 지원자의 가치관과 문제 해결 태도를 확인하세요.
    `;
  } else {
    // Stage 5: 클로징
    stage = "5단계: 비전 및 마무리";
    mission = `
      - 입사 후의 비전이나 커리어 목표를 물어보세요.
      - 마지막으로 하고 싶은 말이 있는지 물어보고 면접을 정리하세요.
    `;
  }

  // 2. 페르소나 및 화법 가이드 (공통)
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
    2. **미러링(Mirroring)**: 바로 질문하지 말고, 지원자의 이전 답변 중 **핵심 키워드를 인용**하며 시작하세요. (예: "방금 말씀하신 **데이터 분석** 과정에서...")
    3. **꼬리물기**: 답변이 추상적이면 구체적인 사례를 요구하고, 결과만 말하면 과정을 물어보세요.
    4. **정중하지만 예리하게**: 무례하게 압박하지 말고, 호기심을 가진 동료처럼 질문하세요.
    5. **한 번에 하나만**: 질문은 간결하게, 한 번에 하나의 논점만 물어보세요.
  `;
}


app.post('/api/chat', async (req, res) => {
  try {
    const { messages, type, job, jd, resume, portfolio } = req.body;

    // (1) 현재 질문 횟수 계산 (User 메시지 수 기반)
    const userMsgCount = messages.filter(m => m.role === 'user').length;
    const questionCount = userMsgCount + 1; // 이번에 AI가 할 질문이 몇 번째인지

    // ==========================================
    // A. 면접 진행 (INTERVIEW)
    // ==========================================
    if (type === 'interview') {
      
      // 15번 질문까지 다 했으면 종료
      if (questionCount > 15) {
        return res.json({ 
          nextQuestion: "긴 시간 동안 고생 많으셨습니다. 면접을 모두 마치겠습니다. 잠시만 기다려 주시면 면접 내용을 분석해 드리겠습니다.",
          isFinished: true 
        });
      }

      // 동적 프롬프트 생성
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
        feedback = "💡 답변이 너무 짧습니다. 구체적인 사례를 들어 설명해 주세요.";
      }

      res.json({ 
        nextQuestion: aiResponse, 
        feedback: feedback,
        currentCount: questionCount,
        totalCount: 15
      });
    } 
    
/* server.js의 'else if (type === 'report')' 부분을 이걸로 교체하세요 */

    else if (type === 'report') {
      
      // [Hard Filter] 침묵 감지 (이전과 동일)
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

      // [핵심] 정밀 진단 프롬프트
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
            "jd_needs": ["데이터", "협업", "Figma", "기획", "문제해결"], (직무에 필요한 핵심 키워드 5개)
            "user_said": ["협업", "기획"], (지원자가 실제 말한 키워드)
            "missing": ["데이터", "Figma", "문제해결"] (지원자가 놓친 키워드)
          },
          
          "feedback_points": [
            {
              "type": "bad",
              "quote": "그냥 열심히 노력해서 해결했습니다.", (지원자의 답변 중 문제되는 문장 인용)
              "advice": "'그냥', '열심히'는 모호합니다. 구체적인 방법(How)을 설명해야 합니다."
            },
            {
              "type": "good",
              "quote": "전년 대비 매출을 20% 성장시켰습니다.", (지원자의 답변 중 잘한 문장 인용)
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

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PITCH AI Server running on port ${PORT}`);
  console.log(`- IP Address: 172.30.1.81 (Make sure to update app.js)`);
});