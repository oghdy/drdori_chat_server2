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
      // 마진을 줄여서 공간 확보
      const doc = new PDFDocument({ margin: 35, size: 'A4' });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // 한글 폰트 설정
      doc.font(fontPath);

      // ========================================
      // 1. 상단: Dr.Dori 로고 + 상태 배지 (한 줄에)
      // ========================================
      const topY = 50;
      
      // 로고
      doc.fontSize(26).fillColor('#00ACC1').text('Dr.Dori', 40, topY);
      
      // 상태 배지 (오른쪽)
      if (encounterData.is_emergency) {
        doc.fillColor('#FFFFFF')
           .rect(doc.page.width - 180, topY - 5, 140, 32)
           .fillAndStroke('#FF0000', '#FF0000');
        doc.fillColor('#FFFFFF').fontSize(13).text('[WARNING]', doc.page.width - 165, topY + 3);
      } else {
        doc.fillColor('#FFFFFF')
           .rect(doc.page.width - 180, topY - 5, 140, 32)
           .fillAndStroke('#00AA00', '#00AA00');
        doc.fillColor('#FFFFFF').fontSize(11).text('[NORMAL]', doc.page.width - 160, topY);
        doc.fontSize(8).text('(No Red Flags)', doc.page.width - 160, topY + 14);
      }

      doc.fillColor('#000000');
      doc.y = topY + 40;

      // ========================================
      // 2. 환자 정보 박스
      // ========================================
      doc.fontSize(14).text(`Name: ${profile.name || '환자'}`, 40, doc.y);
      doc.fontSize(11).fillColor('#555555').text('Patient Summary', 40, doc.y + 2);
      doc.moveDown(0.3);

      doc.fontSize(11).fillColor('#000000')
        .text(`Gender/Age: ${profile.gender || 'N/A'} / ${calculateAge(profile.birth_date)} | Language: ${profile.language || 'English'}`, 40, doc.y);
      
      doc.moveDown(1.2);

      // ========================================
      // 3. Chief Complaint (컴팩트하게)
      // ========================================
      doc.fontSize(13).fillColor('#000000').text('Chief Complaint: ', { continued: true, underline: true })
        .fontSize(12).text(`${encounterData.cc_kor || '정보 없음'}`, { underline: false });
      doc.fontSize(10).fillColor('#666666').text(`C.C: ${encounterData.cc_eng || 'N/A'}`, 40, doc.y);
      doc.moveDown(1);

      // ========================================
      // 4. History of Present Illness (2열 레이아웃)
      // ========================================
      doc.fontSize(13).fillColor('#000000').text('History of Present Illness', { underline: true });
      doc.moveDown(0.4);

      const leftColumnX = 40;
      const rightColumnX = 310;
      const hpiStartY = doc.y;

      // 왼쪽: 한국어
      doc.fontSize(10).fillColor('#000000')
        .text(encounterData.hpi_kor || '정보 없음', leftColumnX, hpiStartY, { 
          width: 250, 
          align: 'left',
          lineGap: 2
        });

      // 오른쪽: 영어
      const rightStartY = hpiStartY;
      doc.fontSize(9).fillColor('#666666')
        .text('For Patient (English):', rightColumnX, rightStartY, { width: 240 });
      doc.fontSize(10).fillColor('#000000')
        .text(encounterData.hpi_eng || 'No information', rightColumnX, doc.y, { 
          width: 240, 
          align: 'left',
          lineGap: 2
        });

      // 두 컬럼 중 더 긴 쪽에 맞춰 y 위치 조정
      doc.y = Math.max(doc.y, hpiStartY + 60);
      doc.moveDown(0.8);

      // ========================================
      // 5. Pain Score (한 줄로)
      // ========================================
      doc.fontSize(11).fillColor('#000000')
        .text(`Pain Score: ${encounterData.pain_score || 'N/A'} / 10`, 40, doc.y);
      doc.moveDown(1);

      // ========================================
      // 6. Medical History & Alerts (컴팩트하게)
      // ========================================
      doc.fontSize(14).fillColor('#000000').text('Medical History & Alerts', { underline: true });
      doc.moveDown(0.3);

      doc.fontSize(9).fillColor('#FF0000')
        .text('의사 확인 필수 (Must Check for Physician)', 40, doc.y);
      doc.moveDown(0.4);

      // Allergies - 빨간색 + 강조
      doc.fontSize(12).fillColor('#FF0000')
        .text('Allergies: ', { continued: true })
        .text(`"${encounterData.allergies_kor || '없음'} (${encounterData.allergies_eng || 'None'})" - Serious Reaction*`);
      doc.moveDown(0.7);

      // Suggested Department - 빨간색 + 강조
      doc.fontSize(12).fillColor('#FF0000')
        .text('Suggested Dept: ', { continued: true })
        .text(`"${encounterData.suggested_dept_kor || '내과'} (${encounterData.suggested_dept_eng || 'Internal Medicine'})"`);
      doc.moveDown(0.3);

      // Suggested Dept 설명 (작게)
      doc.fontSize(8).fillColor('#777777')
        .text('*Generated by AI based on patient\'s subjective statement. NOT a doctor\'s diagnosis.', 40, doc.y, { width: 520 });
      doc.moveDown(0.8);

      // Urgency & OCR
      doc.fontSize(10).fillColor('#000000')
        .text('Urgency: ', { continued: true })
        .fontSize(9).fillColor('#666666')
        .text('N/A | AI OCR Summary: N/A');
      doc.moveDown(1);

      // ========================================
      // 7. 비흡연자 정보
      // ========================================
      doc.fontSize(10).fillColor('#000000')
        .text('비흡연자 (Non-smoker)', 40, doc.y);
      doc.moveDown(1.5);

      // ========================================
      // 8. 하단 면책 조항 (Disclaimer)
      // ========================================
      doc.fontSize(8).fillColor('#999999')
        .text(
          'Disclaimer: This document is AI-generated based on patient\'s subjective statement. It replaces history taking but NOT the doctor\'s diagnosis. All information should be verified by a licensed healthcare professional.',
          40,
          doc.page.height - 70,
          { 
            align: 'center', 
            width: doc.page.width - 80
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
