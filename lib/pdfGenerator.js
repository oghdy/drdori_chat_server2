const PDFDocument = require('pdfkit');

/**
 * 사용자 프로필과 증상 데이터를 받아 진료카드 PDF를 생성합니다.
 * @param {Object} profile - { name, birthdate, gender }
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
      doc.fontSize(12)
        .text(`Chief Complaint: ${encounterData.chief_complaint || 'N/A'}`)
        .text(`Onset: ${encounterData.symptom_onset || 'N/A'}`)
        .text(`Severity: ${encounterData.symptom_severity || 'N/A'}`)
        .text(`Associated Symptoms: ${(encounterData.associated_symptoms && encounterData.associated_symptoms.length > 0) ? encounterData.associated_symptoms.join(', ') : 'N/A'}`)
        .text(`Concerns: ${encounterData.concerns || 'N/A'}`);

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generateMedicalCardPdf }; 
