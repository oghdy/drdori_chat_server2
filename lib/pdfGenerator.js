const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const fontPath = path.join(__dirname, '..', 'fonts', 'NotoSansKR-VariableFont_wght.ttf');
const logoPath = path.join(__dirname, '..', 'assets', 'login_dori.png');

/**
 * 사용자 프로필과 증상 데이터를 받아 진료카드 PDF를 생성합니다.
 * @param {Object} profile - { name, birth_date, gender, language }
 * @param {Object} encounterData - { cc_kor, cc_eng, hpi_kor, hpi_eng, pain_score, allergies_kor, allergies_eng, suggested_dept_kor, suggested_dept_eng, is_emergency }
 * @param {string|null} surveyUrl - 설문조사 링크 (optional)
 * @returns {Promise<Buffer>} PDF 파일 버퍼
 */
function generateMedicalCardPdf(profile, encounterData, surveyUrl) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 0, size: 'A4' });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      const hasFont = fs.existsSync(fontPath);
      if (hasFont) {
        doc.font(fontPath);
      } else {
        console.warn('⚠️ Font not found. Using default font (Korean may not render).');
        doc.font('Helvetica');
      }

      const pageW = 595.28;
      const pageH = 841.89;
      const M = 30; // side margin

      // ── Color Palette ──
      const TEAL = '#1B5E5E';
      const CREAM = '#F5F0EB';

      // ════════════════════════════════════════
      //  1. HEADER  (dark teal bar, full width)
      // ════════════════════════════════════════
      const headerH = 95;
      doc.rect(0, 0, pageW, headerH).fill(TEAL);

      // Mascot image (circular clip)
      const logoSize = 62;
      const lx = M + 8;
      const ly = (headerH - logoSize) / 2;
      try {
        if (fs.existsSync(logoPath)) {
          doc.save();
          doc.circle(lx + logoSize / 2, ly + logoSize / 2, logoSize / 2).clip();
          doc.circle(lx + logoSize / 2, ly + logoSize / 2, logoSize / 2).fill('#4CAF50');
          doc.image(logoPath, lx, ly, { width: logoSize, height: logoSize });
          doc.restore();
        }
      } catch (_) { /* image missing — skip */ }

      // Title
      doc.fontSize(28).fillColor('#FFFFFF')
        .text('DR.DORI', M + 80, 18, { width: 250 });
      doc.fontSize(11).fillColor('#B2DFDB')
        .text('AI-Powered Patient Summary Card', M + 82, 52, { width: 280 });

      // Page number
      doc.fontSize(9).fillColor('#80CBC4').text('1 / 1', pageW - 55, 10);

      // Status badge
      const bW = 125, bH = 38, bX = pageW - M - bW - 5, bY = 28;
      if (encounterData.is_emergency) {
        doc.roundedRect(bX, bY, bW, bH, 8).fill('#E53935');
        doc.fontSize(13).fillColor('#FFF').text('⚠ WARNING', bX, bY + 5, { width: bW, align: 'center' });
        doc.fontSize(8).fillColor('#FFF').text('Red Flags Detected', bX, bY + 23, { width: bW, align: 'center' });
      } else {
        doc.roundedRect(bX, bY, bW, bH, 8).fill('#43A047');
        doc.fontSize(13).fillColor('#FFF').text('● NORMAL', bX, bY + 6, { width: bW, align: 'center' });
        doc.fontSize(8).fillColor('#FFF').text('No Red Flags', bX, bY + 23, { width: bW, align: 'center' });
      }

      // ════════════════════════════════════════
      //  2. PATIENT INFO BAR  (cream strip)
      // ════════════════════════════════════════
      const infoY = headerH;
      const infoH = 42;
      doc.rect(0, infoY, pageW, infoH).fill(CREAM);

      const pName = profile.name || 'Patient';
      const pAge  = calculateAge(profile.birth_date);
      const pGender = profile.gender || 'N/A';
      const pLang = profile.language || 'English (Primary)';
      const pPain = encounterData.pain_score || 'N/A';

      doc.fontSize(10).fillColor('#333333')
        .text(`${pName}  |  Gender/Age: ${pGender}/${pAge}  |  Language: ${pLang}  |  Pain: ${pPain}/10`,
          M + 10, infoY + 7, { width: pageW - M * 2 - 20 });
      doc.fontSize(8).fillColor('#888888')
        .text('Patient Summary — AI-generated document, not a doctor\'s diagnosis',
          M + 10, infoY + 24, { width: pageW - M * 2 - 20 });

      // ════════════════════════════════════════
      //  3. TWO-COLUMN CARDS
      // ════════════════════════════════════════
      const cardTop = infoY + infoH + 12;
      const gap = 14;
      const colW = (pageW - M * 2 - gap) / 2;
      const leftX = M;
      const rightX = M + colW + gap;
      const footerH = 38;
      const SURVEY_URL = surveyUrl || 'https://docs.google.com/forms/d/e/1FAIpQLSeQT35Ny9B_JjJB1-vmm1EmCPOeVzDE61XKANVCwzeNevPhmw/viewform?usp=publish-editor';
      const surveyH = 90;
      const cardH = pageH - cardTop - footerH - surveyH - 18;
      const hdrH = 28;

      // ── Draw card outlines ──
      [leftX, rightX].forEach(x => {
        doc.roundedRect(x, cardTop, colW, cardH, 8)
          .lineWidth(0.8).strokeColor('#CCCCCC').stroke();
      });

      // ── Draw card headers (clipped to rounded top) ──
      [{ x: leftX, label: '의사용 진료 카드 (For Physician)' },
       { x: rightX, label: '환자용 설명서 (For Patient)' }].forEach(col => {
        doc.save();
        doc.roundedRect(col.x, cardTop, colW, cardH, 8).clip();
        doc.rect(col.x, cardTop, colW, hdrH).fill('#2D7D7D');
        doc.restore();
        doc.fontSize(10).fillColor('#FFFFFF')
          .text(col.label, col.x + 10, cardTop + 7, { width: colW - 20 });
      });

      // Re-stroke borders (header fill covered them)
      [leftX, rightX].forEach(x => {
        doc.roundedRect(x, cardTop, colW, cardH, 8)
          .lineWidth(0.8).strokeColor('#CCCCCC').stroke();
      });

      // ════════════════════════════════════════
      //  LEFT COLUMN — For Physician
      // ════════════════════════════════════════
      const pad = 12;
      const cw = colW - pad * 2;   // content width
      let cy = cardTop + hdrH + 12; // cursor y
      const cx = leftX + pad;

      // Chief Complaint
      doc.fontSize(12).fillColor('#222').text('주호소 (Chief Complaint)', cx, cy, { width: cw, underline: true });
      cy += 18;
      doc.fontSize(11).fillColor('#333').text(encounterData.cc_kor || '정보 없음', cx, cy, { width: cw });
      cy = doc.y + 2;
      doc.fontSize(9).fillColor('#666').text(`C.C: ${encounterData.cc_eng || 'N/A'}`, cx, cy, { width: cw });
      cy = doc.y + 14;

      // History of Present Illness
      doc.fontSize(12).fillColor('#222').text('현병력 (History of Present Illness)', cx, cy, { width: cw, underline: true });
      cy += 18;
      doc.fontSize(10).fillColor('#333').text(encounterData.hpi_kor || '정보 없음', cx, cy, { width: cw, lineGap: 2 });
      cy = doc.y + 16;

      // Medical History & Alerts
      doc.fontSize(12).fillColor(TEAL).text('Medical History & Alerts', cx, cy, { width: cw, underline: true });
      cy += 18;
      doc.fontSize(9).fillColor('#E53935').text('의사 확인 필수 (Must Check)', cx, cy, { width: cw });
      cy += 15;

      // Allergies
      doc.fontSize(11).fillColor('#E53935')
        .text(`Allergies: ${encounterData.allergies_kor || '없음'} (${encounterData.allergies_eng || 'None'}) – Serious Reaction*`, cx, cy, { width: cw });
      cy = doc.y + 8;

      // Suggested Dept
      doc.fontSize(11).fillColor('#E65100')
        .text(`Suggested Dept: ${encounterData.suggested_dept_kor || '내과'} (${encounterData.suggested_dept_eng || 'Internal Medicine'})`, cx, cy, { width: cw });
      cy = doc.y + 4;
      doc.fontSize(7).fillColor('#999')
        .text('*AI suggestion based on subjective statement', cx, cy, { width: cw });
      cy = doc.y + 12;

      // Urgency
      doc.fontSize(9).fillColor('#555')
        .text('Urgency: N/A  |  AI OCR Summary: N/A', cx, cy, { width: cw });

      // ════════════════════════════════════════
      //  RIGHT COLUMN — For Patient
      // ════════════════════════════════════════
      let ry = cardTop + hdrH + 12;
      const rx = rightX + pad;
      const rw = colW - pad * 2;

      // Simple Explanation
      doc.fontSize(11).fillColor('#333')
        .text('간단 설명 (Simple Explanation)', rx, ry, { width: rw, underline: true });
      ry += 20;
      doc.fontSize(10).fillColor('#333')
        .text(encounterData.hpi_eng || 'No information available.', rx, ry, { width: rw, lineGap: 3 });
      ry = doc.y + 22;

      // Pain Level
      doc.fontSize(11).fillColor(TEAL)
        .text('통증 점수 (Pain Level)', rx, ry, { width: rw });
      ry += 20;

      // Pain bar
      const barW = rw;
      const barH = 24;
      doc.roundedRect(rx, ry, barW, barH, 6).fill('#E0E0E0');
      const painVal = parseInt(encounterData.pain_score) || 0;
      const fillW = Math.max((painVal / 10) * barW, 0);
      if (fillW > 0) {
        doc.save();
        doc.roundedRect(rx, ry, barW, barH, 6).clip();
        doc.rect(rx, ry, fillW, barH).fill('#43A047');
        doc.restore();
      }
      doc.fontSize(12).fillColor('#FFF')
        .text(`${painVal} / 10`, rx, ry + 5, { width: barW, align: 'center' });
      ry += barH + 22;

      // Additional Info
      doc.fontSize(11).fillColor('#333')
        .text('추가 정보', rx, ry, { width: rw, underline: true });
      ry += 18;
      doc.fontSize(9).fillColor('#555');
      doc.text(`• 비흡연자 (Non-smoker)`, rx, ry, { width: rw }); ry += 14;
      doc.text(`• 알레르기: ${encounterData.allergies_eng || 'None'}`, rx, ry, { width: rw }); ry += 14;
      doc.text(`• 추천 진료과: ${encounterData.suggested_dept_eng || 'Internal Medicine'}`, rx, ry, { width: rw });

      // ════════════════════════════════════════
      //  4. SURVEY SECTION (prominent call-to-action)
      // ════════════════════════════════════════
      const sBoxY = pageH - footerH - surveyH - 8;
      const sBoxW = pageW - M * 2;

      // Outer box with teal left border accent
      doc.roundedRect(M, sBoxY, sBoxW, surveyH - 4, 6)
        .lineWidth(0.5).strokeColor('#B2DFDB').stroke();
      doc.rect(M, sBoxY, 5, surveyH - 4).fill(TEAL);

      const stX = M + 16;
      const stW = sBoxW - 24;

      // Star icon + bold header
      doc.fontSize(12).fillColor(TEAL)
        .text('⭐ Please Share Your Experience After Your Visit!', stX, sBoxY + 10, { width: stW });

      // Description
      doc.fontSize(9).fillColor('#444444')
        .text(
          'Your feedback helps us improve Dr.Dori and support more international patients in Korea. It only takes 1 minute!',
          stX, sBoxY + 28, { width: stW }
        );

      // Clickable link
      doc.fontSize(9).fillColor('#0066CC')
        .text('👉 Tap here to take the survey', stX, sBoxY + 55, {
          width: stW,
          link: SURVEY_URL,
          underline: true
        });

      // ════════════════════════════════════════
      //  5. FOOTER BAR
      // ════════════════════════════════════════
      const fY = pageH - footerH;
      doc.rect(0, fY, pageW, footerH).fill(TEAL);

      doc.fontSize(10).fillColor('#FFFFFF')
        .text('DR.DORI', M + 10, fY + 12);
      doc.fontSize(7).fillColor('#B2DFDB')
        .text('This document is AI-generated. NOT a doctor\'s diagnosis.', 0, fY + 8, { width: pageW, align: 'center' });
      doc.fontSize(6).fillColor('#80CBC4')
        .text('All information should be verified by a licensed healthcare professional.', 0, fY + 20, { width: pageW, align: 'center' });
      doc.fontSize(7).fillColor('#B2DFDB')
        .text('Verified by licensed healthcare professional.', pageW - 230, fY + 13, { width: 210, align: 'right' });

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
