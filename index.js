// ▼▼▼ 모든 의존성 및 기본 설정은 동일합니다 — 변경 부분은 ★ 로 표시
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { generateMedicalCardPdf } = require('./lib/pdfGenerator');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ─────────────────────────────── OpenAI & Supabase 클라이언트
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─────────────────────────────── System‑prompt
const PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'main.md'), 'utf-8');

// ─────────────────────────────── Function‑calling schema
const defineSaveEncounterSchema = {
  type: 'function',
  function: {
    name: 'save_encounter',
    description: '4가지 질문 완료 시 증상 정보를 저장한다.',
    parameters: {
      type: 'object',
      properties: {
        chief_complaint: { type: 'string' },
        symptom_onset: { type: 'string' },
        symptom_severity: { type: 'string' },
        associated_symptoms: { type: 'array', items: { type: 'string' } },
        concerns: { type: 'string' }
      },
      required: [
        'chief_complaint',
        'symptom_onset',
        'symptom_severity',
        'associated_symptoms',
        'concerns'
      ]
    }
  }
};

// ───────────────────────────────────────── /chat 엔드포인트
app.post('/chat', async (req, res) => {
  try {
    const { user_id, thread_id, user_input } = req.body;
    if (!user_id || !thread_id || !user_input) {
      return res.status(400).json({ error: 'user_id, thread_id, user_input 필수' });
    }

    // 1️⃣ 최근 대화 20개
    const { data: history, error: historyErr } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('user_id', user_id)
      .eq('thread_id', thread_id)
      .order('timestamp', { ascending: true })
      .limit(20);
    if (historyErr) throw historyErr;

    // 2️⃣ messages 배열 구성
    const messages = [
      { role: 'system', content: PROMPT },
      ...(history || []),
      { role: 'user', content: user_input }
    ];

    // 3️⃣ OpenAI 호출
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools: [defineSaveEncounterSchema],
      tool_choice: 'auto'
    });

    const choice = completion.choices[0];

    // 4️⃣ tool‑calls 처리
    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.function.name === 'save_encounter') {
          const args = JSON.parse(toolCall.function.arguments);
          const { data: inserted, error } = await supabase
            .from('encounters')
            .insert({ user_id, thread_id, data: args })
            .select('id')
            .single();
          if (error) throw error;

          // tool 결과도 choices 형태로 래핑
          return res.json({
            encounter_id: inserted.id,
            encounter: args,
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Your symptom information has been saved successfully.'
                }
              }
            ]
          });
        }
      }
    }

    // 5️⃣ 일반 assistant 답변 반환 (choices 구조 유지)
    return res.json({
      choices: [
        {
          message: {
            role: 'assistant',
            content: choice.message.content || ''
          }
        }
      ],
      usage: completion.usage || null
    });
  } catch (err) {
    console.error('chat error:', err);
    res.status(500).json({ error: err.message || err });
  }
});

// ★★★ 여기부터 수정됨 ★★★
// /generate-card 엔드포인트 - PDF 생성 로직 개선
app.post('/generate-card', async (req, res) => {
  try {
    const { user_id, encounter_id } = req.body;
    if (!user_id || !encounter_id) {
      return res.status(400).json({ error: 'user_id, encounter_id 필수' });
    }

    // 1️⃣ 프로필 조회
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('birth_date, gender')
      .eq('id', user_id)
      .single();
    if (profileErr || !profile) throw profileErr || new Error('프로필 조회 실패');

    // 이름 설정 (현재 profiles 테이블에 name이 없으므로 기본값)
    profile.name = '환자';
    profile.language = 'English (Primary)';

    // 2️⃣ 증상 데이터 조회
    const { data: encounter, error: encErr } = await supabase
      .from('encounters')
      .select('data')
      .eq('id', encounter_id)
      .single();
    if (encErr || !encounter) throw encErr || new Error('증상 데이터 조회 실패');

    console.log('Encounter data:', encounter);

    const e = encounter.data;

    // 3️⃣ OpenAI를 사용하여 구조화된 의료 정보 추출
    const extractionPrompt = `
You are a medical documentation assistant. Based on the following patient symptom data, extract and structure the information for a medical card PDF.

**Patient Data:**
- Chief Complaint: ${e.chief_complaint}
- Onset: ${e.symptom_onset}
- Severity: ${e.symptom_severity}
- Associated Symptoms: ${e.associated_symptoms?.join(', ') || 'None'}
- Concerns: ${e.concerns}

**Required Output (JSON format):**
{
  "cc_kor": "주호소 한국어 (기간 포함)",
  "cc_eng": "Chief complaint in English (with duration)",
  "hpi_kor": "현병력 상세 설명 (한국어로 자연스럽게 서술형으로)",
  "hpi_eng": "History of Present Illness in English (narrative format)",
  "pain_score": "숫자만 (1-10) or N/A",
  "allergies_kor": "알레르기 정보 (없으면 '없음')",
  "allergies_eng": "Allergy information (if none, 'None')",
  "suggested_dept_kor": "추천 진료과 (한국어)",
  "suggested_dept_eng": "Suggested Department (English)",
  "is_emergency": true or false
}

**Important:**
- is_emergency should be true if severity > 7 or red flags present
- Translate accurately and naturally
- HPI should be a narrative paragraph, not bullet points
- Include duration information in Chief Complaint
`;

    const extractionResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { 
          role: 'system', 
          content: 'You are a medical information extraction assistant. Always respond in valid JSON format.' 
        },
        { role: 'user', content: extractionPrompt }
      ],
      response_format: { type: 'json_object' }
    });

    let structuredData;
    try {
      structuredData = JSON.parse(extractionResponse.choices[0].message.content);
      console.log('Structured medical data:', structuredData);
    } catch (parseErr) {
      console.error('JSON 파싱 실패:', parseErr);
      // 기본값 설정 (fallback)
      structuredData = {
        cc_kor: `${e.chief_complaint} (${e.symptom_onset})`,
        cc_eng: `${e.chief_complaint} (${e.symptom_onset})`,
        hpi_kor: `환자는 ${e.symptom_onset}부터 ${e.chief_complaint} 증상을 호소합니다. 중증도는 ${e.symptom_severity}/10이며, ${e.associated_symptoms?.join(', ') || '특별한 관련 증상은 없습니다'}. 우려사항: ${e.concerns}`,
        hpi_eng: `Patient reports ${e.chief_complaint} starting ${e.symptom_onset}. Severity: ${e.symptom_severity}/10. Associated symptoms: ${e.associated_symptoms?.join(', ') || 'None'}. Concerns: ${e.concerns}`,
        pain_score: e.symptom_severity || 'N/A',
        allergies_kor: '정보 없음',
        allergies_eng: 'Unknown',
        suggested_dept_kor: '내과',
        suggested_dept_eng: 'Internal Medicine',
        is_emergency: parseInt(e.symptom_severity) > 7
      };
    }

    // 4️⃣ PDF 생성 (구조화된 데이터 전달)
    const pdfBuffer = await generateMedicalCardPdf(profile, structuredData);

    // 5️⃣ Storage 업로드 & signed URL 생성
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `medical-card-${user_id}-${ts}.pdf`;
    const pathInBucket = `${user_id}/${filename}`;

    const { error: uploadErr } = await supabase.storage
      .from('medical-records')
      .upload(pathInBucket, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });
    if (uploadErr) throw uploadErr;

    const { data: signed, error: signedErr } = await supabase.storage
      .from('medical-records')
      .createSignedUrl(pathInBucket, 60 * 60);
    if (signedErr || !signed) throw signedErr || new Error('signed URL 생성 실패');

    // 6️⃣ medical_records 테이블 기록
    const { data: record, error: recErr } = await supabase
      .from('medical_records')
      .insert({ user_id, encounter_id, pdf_url: signed.signedUrl, status: 'active' })
      .select('id')
      .single();
    if (recErr || !record) throw recErr || new Error('medical_records 저장 실패');

    res.json({ pdf_url: signed.signedUrl, record_id: record.id });
  } catch (err) {
    console.error('generate-card error:', err);
    res.status(500).json({ error: err.message || err });
  }
});
// ★★★ 수정 끝 ★★★

// ───────────────────────────────────────── 서버 실행
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
