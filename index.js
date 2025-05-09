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

// OpenAI 클라이언트 초기화
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Supabase 클라이언트 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// system prompt 상수
const PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'main.md'), 'utf-8');

// Function Calling 스키마
defineSaveEncounterSchema = {
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

// POST /chat 엔드포인트 (Function Calling 기반)
app.post('/chat', async (req, res) => {
  try {
    const { user_id, thread_id, user_input } = req.body;
    if (!user_id || !thread_id || !user_input) {
      return res.status(400).json({ error: 'user_id, thread_id, user_input 필수' });
    }

    // 1. 과거 대화 불러오기
    const { data: history, error: historyError } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('user_id', user_id)
      .eq('thread_id', thread_id)
      .order('timestamp', { ascending: true })
      .limit(20);

    if (historyError) throw historyError;

    // 2. messages 배열 구성
    const messages = [
      { role: 'system', content: PROMPT },
      ...(history || []),
      { role: 'user', content: user_input }
    ];

    // 3. OpenAI 호출 (Function Calling)
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools: [defineSaveEncounterSchema],
      tool_choice: 'auto'
    });

    const choice = completion.choices[0];

    // 4. tool_calls 처리
    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.function.name === 'save_encounter') {
          // arguments는 string이므로 파싱 필요
          const args = JSON.parse(toolCall.function.arguments);

          // Supabase encounters 테이블에 저장
          const { data: insertData, error: insertError } = await supabase
            .from('encounters')
            .insert({
              user_id,
              thread_id,
              data: args
            })
            .select('id')
            .single();

          if (insertError) throw insertError;

          return res.json({
            message: '증상 정보가 성공적으로 저장되었습니다.',
            encounter_id: insertData.id,
            encounter: args
          });
        }
      }
    }

    // 5. 일반 답변 반환
    return res.json({
      message: choice.message.content
    });

  } catch (error) {
    console.error('chat error:', error);
    res.status(500).json({ error: error.message || error });
  }
});

// 진료카드 PDF 생성 및 업로드 엔드포인트
app.post('/generate-card', async (req, res) => {
  try {
    const { user_id, encounter_id } = req.body;
    if (!user_id || !encounter_id) {
      return res.status(400).json({ error: 'user_id, encounter_id 필수' });
    }

    // 1. 프로필 조회
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('name, birthdate, gender')
      .eq('user_id', user_id)
      .single();
    if (profileError || !profile) throw profileError || new Error('프로필 조회 실패');

    // 2. 증상 데이터 조회
    const { data: encounter, error: encounterError } = await supabase
      .from('encounters')
      .select('data')
      .eq('id', encounter_id)
      .single();
    if (encounterError || !encounter) throw encounterError || new Error('증상 데이터 조회 실패');

    // 3. PDF 생성
    const pdfBuffer = await generateMedicalCardPdf(profile, encounter.data);

    // 4. Supabase Storage 업로드
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `medical-record-${user_id}-${timestamp}.pdf`;
    const uploadPath = `${user_id}/${filename}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('medical-records')
      .upload(uploadPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });
    if (uploadError) throw uploadError;

    // 5. signed URL 생성 (1시간)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('medical-records')
      .createSignedUrl(uploadPath, 60 * 60);
    if (signedUrlError || !signedUrlData) throw signedUrlError || new Error('signed URL 생성 실패');

    // 6. medical_records 테이블에 insert
    const { data: recordData, error: recordError } = await supabase
      .from('medical_records')
      .insert({
        user_id,
        encounter_id,
        pdf_url: signedUrlData.signedUrl,
        status: 'active'
      })
      .select('id')
      .single();
    if (recordError || !recordData) throw recordError || new Error('medical_records 저장 실패');

    // 7. 응답
    res.json({
      pdf_url: signedUrlData.signedUrl,
      record_id: recordData.id
    });
  } catch (error) {
    console.error('generate-card error:', error);
    res.status(500).json({ error: error.message || error });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
