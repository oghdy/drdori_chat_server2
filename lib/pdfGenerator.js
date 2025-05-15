const PDFDocument = require('pdfkit');
const path = require('path');
const fontPath = path.join(__dirname, '..', 'fonts', 'NotoSansKR-VariableFont_wght.ttf');

/**
 * 사용자 프로필과 증상 데이터를 받아 진료카드 PDF를 생성합니다.
 * @param {Object} profile - { birthdate, gender }
 * @param {Object} encounterData - { chief_complaint, symptom_onset, symptom_severity, associated_symptoms, concerns }
 * @returns {Promise<Buffer>} PDF 파일 버퍼
 */
function generateMedicalCardPdf(profile, encounterData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument();
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // Set font to support Korean
      doc.font(fontPath);

      // 제목
      doc.fontSize(20).text('Medical Card', { align: 'center' });
      doc.moveDown();

      // 사용자 정보
      doc.fontSize(14).text('Patient Information');
      doc.fontSize(12)
        
        .text(`Birthdate: ${profile.birthdate || 'N/A'}`)
        .text(`Gender: ${profile.gender || 'N/A'}`);
      doc.moveDown();

      // 증상 요약
      doc.fontSize(14).text('Symptom Summary');
      doc.fontSize(12).text(encounterData); // combinedText 출력

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generateMedicalCardPdf }; 
