const PDFDocument = require('pdfkit');
const path = require('path');
const fontPath = path.join(__dirname, '..', 'fonts', 'NotoSansKR-VariableFont_wght.ttf');

/**
 * 사용자 프로필과 증상 데이터를 받아 진료카드 PDF를 생성합니다.
 * @param {Object} profile - { name, birth_date, gender, language }
 * @param {Object} encounterData - { cc_kor, cc_eng, hpi_kor, hpi_eng, pain_score, allergies_kor, suggested_dept_kor, suggested_dept_eng, is_emergency }
 * @returns {Promise<Buffer>} PDF 파일 버퍼
 */
function generateMedicalCardPdf(profile, encounterData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // 한글 폰트 설정
      doc.font(fontPath);

      // ========================================
      // 1. 상단: Dr.Dori 로고 + 상태 배지
      // ========================================
      doc.fontSize(24).fillColor('#00ACC1').text('Dr.Dori', { align: 'center' });
      doc.moveDown(0.3);

      // 이름 + Patient Summary
      doc.fontSize(14).fillColor('#000000').text(`Name: ${profile.name || 'N/A'}`, { align: 'center' });
      doc.fontSize(12).fillColor('#000000').text('Patient Summary', { align: 'center' });
      doc.moveDown(0.5);

      // 상태 배지 (is_emergency에 따라 색상 변경)
      if (encounterData.is_emergency) {
        doc.fillColor('#FFFFFF')
           .rect(doc.page.width - 200, 100, 150, 30)
           .fillAndStroke('#FF0000', '#FF0000');
        doc.fillColor('#FFFFFF').fontSize(12).text('[WARNING]', doc.page.width - 190, 108);
      } else {
        doc.fillColor('#FFFFFF')
           .rect(doc.page.width - 200, 100, 150, 30)
           .fillAndStroke('#00AA00', '#00AA00');
        doc.fillColor('#FFFFFF').fontSize(10).text('[NORMAL]', doc.page.width - 180, 105);
        doc.fontSize(8).text('(No Red Flags detected)', doc.page.width - 185, 118);
      }

      doc.fillColor('#000000');
      doc.moveDown(2);

      // ========================================
      // 2. 환자 기본 정보
      // ========================================
      const currentY1 = doc.y;
      doc.fontSize(10)
        .text(`${profile.name || 'N/A'}`, 50, currentY1)
        .text(`Gender/Age: ${profile.gender || 'N/A'} / ${calculateAge(profile.birth_date)}`, 50, currentY1 + 15)
        .text(`Language: ${profile.language || 'English (Primary)'}`, 50, currentY1 + 30);
      
      doc.moveDown(3);

      // ========================================
      // 3. Chief Complaint (주호소)
      // ========================================
      doc.fontSize(13).fillColor('#000000').text('Chief Complaint: ', { continued: true, underline: true })
        .fontSize(11).fillColor('#000000').text(`${encounterData.cc_kor} (${encounterData.cc_eng})`, { underline: false });
      doc.moveDown(0.5);

      // C.C 설명
      doc.fontSize(9).fillColor('#555555')
        .text(`C.C: ${encounterData.cc_eng}`, 50, doc.y);
      doc.moveDown(1.5);

      // ========================================
      // 4. History of Present Illness (2열 레이아웃)
      // ========================================
      doc.fontSize(12).fillColor('#000000').text('History of Present Illness', { underline: true });
      doc.moveDown(0.5);

      const leftColumnX = 50;
      const rightColumnX = 300;
      const hpiStartY = doc.y;

      // 왼쪽: 한국어
      doc.fontSize(9).fillColor('#000000')
        .text(encounterData.hpi_kor || '정보 없음', leftColumnX, hpiStartY, { 
          width: 230, 
          align: 'left' 
        });

      // 오른쪽: 영어
      doc.fontSize(9).fillColor('#000000')
        .text('For Patient (English)', rightColumnX, hpiStartY, { width: 230 });
      doc.fontSize(9)
        .text(encounterData.hpi_eng || 'No information', rightColumnX, doc.y, { 
          width: 230, 
          align: 'left' 
        });

      // 두 컬럼 중 더 긴 쪽에 맞춰 y 위치 조정
      doc.y = Math.max(doc.y, hpiStartY + 100);
      doc.moveDown(1);

      // ========================================
      // 5. Pain Score
      // ========================================
      doc.fontSize(10).fillColor('#000000')
        .text(`Pain Score: ${encounterData.pain_score || 'N/A'} / 10 (인후통)`, 50, doc.y);
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor('#555555')
        .text(`Pain Score: ${encounterData.pain_score || 'N/A'} (인후통 기준)`, 50, doc.y);
      doc.moveDown(2);

      // ========================================
      // 6. Medical History & Alerts
      // ========================================
      doc.fontSize(14).fillColor('#000000').text('Medical History & Alerts', { underline: true });
      doc.moveDown(0.5);

      // 의사 확인 필수 문구
      doc.fontSize(8).fillColor('#FF0000')
        .text('의사 확인 필수 (Must Check for Physician)', 50, doc.y);
      doc.moveDown(0.5);

      // Allergies - 빨간색 + Bold
      doc.fontSize(11).fillColor('#FF0000')
        .text(`Allergies: `, { continued: true })
        .text(`"${encounterData.allergies_kor || '없음'} (${encounterData.allergies_eng || 'None'})" - Serious Reaction*`, { continued: false });
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor('#000000')
        .text(`암유율`, 50, doc.y);
      doc.moveDown(1);

      // Suggested Department - 빨간색
      doc.fontSize(11).fillColor('#FF0000')
        .text(`Suggested Dept: `, { continued: true })
        .text(`"${encounterData.suggested_dept_kor || 'N/A'} (${encounterData.suggested_dept_eng || 'Internal Medicine'})" 또는 이비인후과`, { continued: false });
      doc.moveDown(0.5);

      // Suggested Dept 설명
      doc.fontSize(8).fillColor('#555555')
        .text('Suggested Dept: generated by AI based on patient\'s subjective statement. It replaces history taking but NOT the doctor\'s diagnosis.', 50, doc.y, { width: 500 });
      doc.moveDown(0.5);

      // Urgency
      doc.fontSize(9).fillColor('#000000')
        .text(`Urgency:`, 50, doc.y);
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor('#000000')
        .text(`AI OCR Summary: (NA)`, 50, doc.y);
      doc.moveDown(2);

      // ========================================
      // 7. 비흡연자 정보 (예시)
      // ========================================
      doc.fontSize(9).fillColor('#000000')
        .text(`비흡연자`, 50, doc.y);
      doc.text(`(Non-smoker)`, 50, doc.y);
      doc.moveDown(3);

      // ========================================
      // 8. 하단 면책 조항 (Disclaimer)
      // ========================================
      doc.fontSize(7).fillColor('#999999')
        .text(
          'Disclaimer: This document is AI-generated based on patient\'s subjective statement. ' +
          'It replaces history taking but NOT the doctor\'s diagnosis. ' +
          'All information should be verified by a licensed healthcare professional.',
          50,
          doc.page.height - 80,
          { 
            align: 'center', 
            width: doc.page.width - 100 
          }
        );

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * 생년월일로부터 나이 계산
 */
function calculateAge(birthdate) {
  if (!birthdate) return 'N/A';
  const birth = new Date(birthdate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

module.exports = { generateMedicalCardPdf };
