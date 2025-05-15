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

// Update translation logic using the latest OpenAI Node.js SDK
async function translateToKorean(text) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful medical translator.'
        },
        {
          role: 'user',
          content: `Translate the following medical information to Korean:\n\n${text}`
        }
      ]
    });
    const translatedText = response.choices[0].message.content;
    return translatedText;
  } catch (error) {
    console.error('Translation error:', error);
    return '번역 실패';
  }
}

// Modify the /generate-card endpoint to include translation
app.post('/generate-card', async (req, res) => {
  try {
    const { user_id, encounter_id } = req.body;
    if (!user_id || !encounter_id) {
      return res.status(400).json({ error: 'user_id, encounter_id 필수' });
    }

    // 프로필 조회
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('birth_date, gender')
      .eq('id', user_id)
      .single();
    if (profileErr || !profile) throw profileErr || new Error('프로필 조회 실패');

    // 이름 필드 제거 또는 대체
    profile.name = '이름 없음';

    // 증상 데이터 조회
    const { data: encounter, error: encErr } = await supabase
      .from('encounters')
      .select('data')
      .eq('id', encounter_id)
      .single();
    if (encErr || !encounter) throw encErr || new Error('증상 데이터 조회 실패');

    // Log the structure of encounter to verify data access
    console.log('Encounter data:', encounter);

    const e = encounter.data;
    const englishText = `Chief Complaint: ${e.chief_complaint}
Onset: ${e.symptom_onset}
Severity: ${e.symptom_severity}
Associated Symptoms: ${e.associated_symptoms?.join(', ') || 'None'}
Concerns: ${e.concerns}`;

    const koreanText = await translateToKorean(englishText);
    const combinedText = `${englishText}\n\n[번역]\n${koreanText}`;

    // Pass combinedText to generateMedicalCardPdf
    const pdfBuffer = await generateMedicalCardPdf(profile, combinedText);

    // Storage 업로드 & signed URL 생성
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `medical-record-${user_id}-${ts}.pdf`;
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

    // medical_records 테이블 기록
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

// ───────────────────────────────────────── 서버 실행
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
