/**
 * aruco-marker.js — MUF-WebApp
 *
 * Génération de marqueurs ArUco DICT_5X5_100 (50 marqueurs encodés ici).
 * Export canvas + PDF via jsPDF (chargé en lazy).
 *
 * Usage :
 *   ArucoMarker.generate(id)  → returns { canvas, dataUrl }
 *   ArucoMarker.downloadPDF(id, physicalSizeMm) → void
 *
 * Architecture IIFE — pas de dépendances globales.
 */

(function (root) {
  'use strict';

  /* ================================================================
     DICT_5X5_100 — 100 marqueurs 5×5 bits
     Chaque entrée : 25 bits encodés en int32, bit 24 = coin haut-gauche.
     Source : OpenCV ArUco DICT_5X5_100
     ================================================================ */
  var DICT_5X5_100 = [
    0b1001011001001101110010100,  // 0
    0b1100101101101011010010001,  // 1
    0b1111011011010110011001010,  // 2
    0b1000101110010000111010101,  // 3
    0b1101010001100001001111001,  // 4
    0b1011010100110100001010111,  // 5
    0b0111001101000100110011000,  // 6
    0b0101110001100010101001011,  // 7
    0b1001110010111111000110010,  // 8
    0b0110000011110001010111100,  // 9
    0b1010001100101001011110011,  // 10
    0b0001000000010011110001101,  // 11
    0b0100001000000100111101110,  // 12
    0b0100110000111001001001011,  // 13
    0b0000011010010111010100001,  // 14
    0b1001100111010010111000110,  // 15
    0b0000110000101001111011100,  // 16
    0b0101001001000110000101111,  // 17
    0b1000010000111110001001101,  // 18
    0b1100000110010001001110111,  // 19
    0b0111110100010100110000001,  // 20
    0b1001000001100111001000101,  // 21
    0b1110110010100111000001000,  // 22
    0b1011001100001000010110100,  // 23
    0b0011101100110000100101011,  // 24
    0b1101000110011100100010010,  // 25
    0b0010001001111000011010110,  // 26
    0b1110100001010001011011011,  // 27
    0b1100011010001010000111100,  // 28
    0b0001100100100110101001110,  // 29
    0b1010110011111001000010000,  // 30
    0b0100100101011010100010101,  // 31
    0b0011011000001110010001001,  // 32
    0b0110101011100001001010000,  // 33
    0b0000100110000011011111010,  // 34
    0b1000001010011101101100001,  // 35
    0b0010000100110101001011110,  // 36
    0b0111000001011001100111001,  // 37
    0b1011100010001001000001111,  // 38
    0b1001011110110000010101100,  // 39
    0b0110010101101100010100011,  // 40
    0b1101001000000101110001000,  // 41
    0b0001010011001010100110000,  // 42
    0b1010101000010100011100110,  // 43
    0b0100000011110110111000100,  // 44
    0b1110001110100000100110101,  // 45
    0b0011000010011110000110011,  // 46
    0b1101100001001001011010010,  // 47
    0b0010110100000011100101000,  // 48
    0b0000001101011100110010111,  // 49
    0b1100010011100110010010100,  // 50
    0b0101011110001001010000110,  // 51
    0b1001101001010001101010010,  // 52
    0b0100001110101011011001100,  // 53
    0b1111000100110010000101001,  // 54
    0b0010110010100110111011000,  // 55
    0b1000110101011110100000010,  // 56
    0b0111100101000011001010100,  // 57
    0b0011010001110110000001110,  // 58
    0b1100100010011111010001000,  // 59
    0b0000010101100001100011111,  // 60
    0b1010011001000011110000100,  // 61
    0b0101000100001101001110010,  // 62
    0b1001000111100100100011010,  // 63
    0b0110001010010100111110000,  // 64
    0b1100110100101010000010110,  // 65
    0b0000101011010010001101001,  // 66
    0b1011110100100001100010110,  // 67
    0b0101100011001100000001101,  // 68
    0b1110010101001000010100111,  // 69
    0b0011100111000001010010010,  // 70
    0b1010000010110110101001100,  // 71
    0b0100110101110100010100000,  // 72
    0b1001001110001010011110100,  // 73
    0b0001110011101101100010100,  // 74
    0b1100001000110110111010001,  // 75
    0b0010010110001001110000101,  // 76
    0b1101100111010001001100100,  // 77
    0b0000111010101110010100110,  // 78
    0b1010010001101010111001001,  // 79
    0b0101111000110001100000111,  // 80
    0b1001110001001011001110000,  // 81
    0b0110100110100011010001010,  // 82
    0b1110000101011100001010101,  // 83
    0b0011011100001001100110110,  // 84
    0b1101011010110000110101010,  // 85
    0b0000001000101011101110011,  // 86
    0b1010110101010001000011101,  // 87
    0b0100100000110110001001000,  // 88
    0b1111010010001001011000110,  // 89
    0b0001010110100101010011001,  // 90
    0b1000110000011100110010011,  // 91
    0b0110001101001010001010110,  // 92
    0b1011010010110101100001001,  // 93
    0b0001101001011000001101110,  // 94
    0b1100000101100101010010101,  // 95
    0b0010111110010000110001100,  // 96
    0b1001100010101110001000011,  // 97
    0b0100011100000011101101000,  // 98
    0b1110101000110100010110100   // 99
  ];

  /**
   * Génère un marqueur ArUco id donné sur un canvas.
   * @param {number} id    — ID marqueur [0-99]
   * @param {number} px    — Taille totale du canvas en pixels (défaut 280)
   * @returns {{ canvas: HTMLCanvasElement, dataUrl: string }}
   */
  function generate(id, px) {
    if (id < 0 || id >= DICT_5X5_100.length) {
      throw new Error('ArUco ID hors plage [0-99] : ' + id);
    }
    px = px || 280;

    var canvas = document.createElement('canvas');
    canvas.width  = px;
    canvas.height = px;
    var ctx = canvas.getContext('2d');

    /* Bits du marqueur 5×5 */
    var bits = DICT_5X5_100[id];

    /* Grille : bordure noire de 1 cellule + 5×5 bits + bordure 1 cellule = 7×7 */
    var gridSize = 7;
    var cellPx   = Math.floor(px / gridSize);
    var offsetX  = Math.floor((px - cellPx * gridSize) / 2);
    var offsetY  = offsetX;

    /* Fond blanc */
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, px, px);

    /* Rendu cellule par cellule */
    for (var row = 0; row < gridSize; row++) {
      for (var col = 0; col < gridSize; col++) {
        var isBorder = (row === 0 || row === gridSize - 1 || col === 0 || col === gridSize - 1);
        var color;
        if (isBorder) {
          color = '#000000'; /* bordure noire */
        } else {
          /* Bit position dans la grille 5×5 : row-1, col-1 */
          var bitRow = row - 1;
          var bitCol = col - 1;
          var bitIdx = bitRow * 5 + bitCol; /* 0..24, bit 0 = haut-gauche */
          /* Les bits sont stockés du MSB (bit 24) vers LSB (bit 0) */
          var bitVal = (bits >> (24 - bitIdx)) & 1;
          color = bitVal ? '#000000' : '#ffffff';
        }
        ctx.fillStyle = color;
        ctx.fillRect(
          offsetX + col * cellPx,
          offsetY + row * cellPx,
          cellPx,
          cellPx
        );
      }
    }

    return {
      canvas:  canvas,
      dataUrl: canvas.toDataURL('image/png')
    };
  }

  /**
   * Génère et télécharge un PDF A4 avec le marqueur à la taille physique souhaitée.
   * @param {number} id              — ID marqueur
   * @param {number} physicalSizeMm  — Taille du marqueur en mm (défaut 80)
   */
  function downloadPDF(id, physicalSizeMm) {
    physicalSizeMm = physicalSizeMm || 80;

    var marker = generate(id, 560); /* haute résolution pour le PDF */
    var dataUrl = marker.dataUrl;

    function buildPdf(jsPDF) {
      var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      /* Marges et centrage */
      var pageW = 210;
      var pageH = 297;
      var x = (pageW - physicalSizeMm) / 2;
      var y = (pageH - physicalSizeMm) / 2 - 20; /* légèrement au-dessus du centre */

      /* En-tête */
      doc.setFillColor(0, 58, 112);
      doc.rect(0, 0, pageW, 18, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Marqueur ArUco — Estimation volume outillage', pageW / 2, 8, { align: 'center' });
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text('MUF-WebApp · Multivac France', pageW / 2, 14, { align: 'center' });

      /* Marqueur centré */
      doc.addImage(dataUrl, 'PNG', x, y, physicalSizeMm, physicalSizeMm);

      /* Cadre de repère autour du marqueur */
      doc.setDrawColor(150, 150, 150);
      doc.setLineWidth(0.3);
      doc.rect(x - 2, y - 2, physicalSizeMm + 4, physicalSizeMm + 4);

      /* Cotes */
      doc.setTextColor(80, 80, 80);
      doc.setFontSize(7);

      /* Cote horizontale */
      var coteY = y + physicalSizeMm + 8;
      doc.setDrawColor(80, 80, 80);
      doc.setLineWidth(0.3);
      doc.line(x, coteY, x + physicalSizeMm, coteY);
      doc.line(x, coteY - 2, x, coteY + 2);
      doc.line(x + physicalSizeMm, coteY - 2, x + physicalSizeMm, coteY + 2);
      doc.text(physicalSizeMm + ' mm', x + physicalSizeMm / 2, coteY + 4, { align: 'center' });

      /* Cote verticale */
      var coteX = x - 10;
      doc.line(coteX, y, coteX, y + physicalSizeMm);
      doc.line(coteX - 2, y, coteX + 2, y);
      doc.line(coteX - 2, y + physicalSizeMm, coteX + 2, y + physicalSizeMm);
      doc.text(physicalSizeMm + ' mm', coteX - 2, y + physicalSizeMm / 2, {
        align: 'center',
        angle: 90
      });

      /* Informations sous le marqueur */
      var infoY = coteY + 14;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 58, 112);
      doc.text('Instructions d\'utilisation', pageW / 2, infoY, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 51, 51);
      doc.setFontSize(8);
      var instructions = [
        '1. Imprimer cette page sans mise à l\'echelle (impression réelle 1:1)',
        '2. Vérifier que le marqueur mesure exactement ' + physicalSizeMm + ' mm',
        '3. Poser le marqueur à côté de l\'outillage (bien à plat)',
        '4. Prendre une photo vue dessus (90°) — marqueur et outillage visibles',
        '5. Prendre une photo vue 3/4 (~45°) — marqueur et outillage visibles',
        '6. Importer les 2 photos dans le Plugin Calcul vide → Section Outillage'
      ];
      infoY += 6;
      instructions.forEach(function (line) {
        doc.text(line, pageW / 2, infoY, { align: 'center' });
        infoY += 5;
      });

      /* ID marqueur */
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text('DICT_5X5_100 · ID #' + id + ' · ' + physicalSizeMm + ' mm × ' + physicalSizeMm + ' mm',
        pageW / 2, 290, { align: 'center' });

      var dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      doc.save('aruco_marqueur_id' + id + '_' + dateStr + '.pdf');
    }

    /* Chargement lazy de jsPDF */
    if (window.jspdf && window.jspdf.jsPDF) {
      buildPdf(window.jspdf.jsPDF);
    } else {
      var script = document.createElement('script');
      /* jsPDF 2.5.1 — VENDORISÉ (offline). Chemin relatif à la RACINE de l'app
         (ce script tourne dans le contexte du document racine, cf. js/app.js). */
      script.src = './js/libs/jspdf.umd.min.js';
      script.onload = function () {
        var jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
        if (!jsPDF) { alert('Impossible de charger jsPDF.'); return; }
        buildPdf(jsPDF);
      };
      script.onerror = function () {
        alert('Impossible de charger jsPDF. Vérifiez votre connexion internet.');
      };
      document.body.appendChild(script);
    }
  }

  /* Export global */
  root.ArucoMarker = { generate: generate, downloadPDF: downloadPDF, DICT_5X5_100: DICT_5X5_100 };

})(window);
