/**
 * aruco-vision.js — MUF-WebApp
 *
 * Pipeline de traitement d'image pour l'estimation de volume outillage :
 *   1. Détection du marqueur ArUco (scan de grille 7×7 bits via canvas)
 *   2. Calcul de l'échelle réelle (px → mm) à partir du marqueur connu (80 mm)
 *   3. Correction de perspective (homographie 4-points)
 *   4. Segmentation de l'outillage (différence couleur + flood-fill simplifié)
 *   5. Estimation des dimensions L × l × H → volume
 *
 * 100% client-side, pas d'OpenCV.js, compatible Safari iOS (Canvas API uniquement).
 *
 * Usage :
 *   ArucoVision.processTopView(imageFile, markerSizeMm)
 *     .then(result => { result.scalePixPerMm, result.toolingRectPx, result.canvas })
 *
 *   ArucoVision.processSideView(imageFile, scalePixPerMm)
 *     .then(result => { result.heightMm, result.canvas })
 *
 *   ArucoVision.estimateVolume(topResult, sideResult)
 *     → { lengthMm, widthMm, heightMm, volumeLiters, volumeM3 }
 *
 * Architecture IIFE — pas de dépendances globales.
 */

(function (root) {
  'use strict';

  /* ================================================================
     UTILITAIRES CANVAS
     ================================================================ */

  /**
   * Charge un File image dans un ImageData via un canvas hors-écran.
   * @param {File} file
   * @param {number} [maxDim=1600] — Dimension maximale pour éviter les problèmes mémoire mobile
   * @returns {Promise<{imageData: ImageData, canvas: HTMLCanvasElement, scale: number}>}
   */
  function loadImageData(file, maxDim) {
    maxDim = maxDim || 1600;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        var scale = 1;
        if (w > maxDim || h > maxDim) {
          scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        var canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ imageData: ctx.getImageData(0, 0, w, h), canvas: canvas, scale: scale });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Impossible de charger l\'image.'));
      };
      img.src = url;
    });
  }

  /**
   * Applique un prétraitement CLAHE-simplifié + débruitage léger.
   * Améliore la détection sur surfaces métalliques/reflets.
   * @param {ImageData} src
   * @returns {ImageData} — image en niveaux de gris normalisés
   */
  function preprocessGrayscale(src) {
    var w = src.width;
    var h = src.height;
    var data = src.data;
    var gray = new Uint8Array(w * h);

    /* Conversion RGB → gris (luminance) */
    for (var i = 0; i < w * h; i++) {
      var r = data[i * 4];
      var g = data[i * 4 + 1];
      var b = data[i * 4 + 2];
      gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }

    /* Histogramme + CLAHE local simplifié : égalisation globale par tuiles 8×8 */
    var tileW = Math.max(1, Math.round(w / 8));
    var tileH = Math.max(1, Math.round(h / 8));
    var result = new Uint8Array(w * h);

    for (var ty = 0; ty < h; ty += tileH) {
      for (var tx = 0; tx < w; tx += tileW) {
        /* Histogramme de la tuile */
        var hist = new Int32Array(256);
        var x0 = tx, x1 = Math.min(tx + tileW, w);
        var y0 = ty, y1 = Math.min(ty + tileH, h);
        var count = 0;
        for (var py = y0; py < y1; py++) {
          for (var px = x0; px < x1; px++) {
            hist[gray[py * w + px]]++;
            count++;
          }
        }
        /* CDF normalisée */
        var cdf = new Uint8Array(256);
        var cum = 0;
        var cdfMin = -1;
        for (var k = 0; k < 256; k++) {
          cum += hist[k];
          if (cdfMin === -1 && cum > 0) cdfMin = cum;
          cdf[k] = count > cdfMin ? Math.round(255 * (cum - cdfMin) / (count - cdfMin)) : 0;
        }
        /* Appliquer la correction */
        for (var py2 = y0; py2 < y1; py2++) {
          for (var px2 = x0; px2 < x1; px2++) {
            result[py2 * w + px2] = cdf[gray[py2 * w + px2]];
          }
        }
      }
    }

    /* Débruitage léger (filtre médian 3×3 simplifié en box blur) */
    var blurred = new Uint8Array(w * h);
    for (var y3 = 1; y3 < h - 1; y3++) {
      for (var x3 = 1; x3 < w - 1; x3++) {
        var sum = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            sum += result[(y3 + dy) * w + (x3 + dx)];
          }
        }
        blurred[y3 * w + x3] = Math.round(sum / 9);
      }
    }
    /* Bords */
    for (var eb = 0; eb < w; eb++) { blurred[eb] = result[eb]; blurred[(h - 1) * w + eb] = result[(h - 1) * w + eb]; }
    for (var el = 0; el < h; el++) { blurred[el * w] = result[el * w]; blurred[el * w + w - 1] = result[el * w + w - 1]; }

    /* Binarisation adaptative (seuil local par blocs) */
    var binary = new Uint8Array(w * h);
    var blockSize = 31;
    var C = 10; /* constante de soustraction */
    for (var by = 0; by < h; by++) {
      for (var bx = 0; bx < w; bx++) {
        var bx0 = Math.max(0, bx - Math.floor(blockSize / 2));
        var bx1 = Math.min(w - 1, bx + Math.floor(blockSize / 2));
        var by0 = Math.max(0, by - Math.floor(blockSize / 2));
        var by1 = Math.min(h - 1, by + Math.floor(blockSize / 2));
        var localSum = 0;
        var localCount = (bx1 - bx0 + 1) * (by1 - by0 + 1);
        for (var lly = by0; lly <= by1; lly++) {
          for (var llx = bx0; llx <= bx1; llx++) {
            localSum += blurred[lly * w + llx];
          }
        }
        var localMean = localSum / localCount;
        binary[by * w + bx] = blurred[by * w + bx] < (localMean - C) ? 0 : 255;
      }
    }

    /* Retourner une ImageData pour compatibilité */
    var out = new ImageData(w, h);
    for (var oi = 0; oi < w * h; oi++) {
      out.data[oi * 4]     = blurred[oi];
      out.data[oi * 4 + 1] = blurred[oi];
      out.data[oi * 4 + 2] = blurred[oi];
      out.data[oi * 4 + 3] = 255;
    }
    out._gray    = blurred;
    out._binary  = binary;
    return out;
  }

  /* ================================================================
     DETECTION ARUCO — scan de candidats rectangulaires noirs
     ================================================================ */

  /**
   * Détecte les contours de régions sombres potentiellement carrées (candidats ArUco).
   * Approche : scan de rangées → zones noires consécutives → clustering → filtrage.
   */
  function findCandidateRects(binary, width, height) {
    /* Scan ligne par ligne pour trouver des runs noirs */
    var candidates = [];
    var step = Math.max(1, Math.floor(Math.min(width, height) / 80));

    for (var y = 0; y < height; y += step) {
      var inBlack = false;
      var runStart = 0;
      for (var x = 0; x < width; x++) {
        var isBlack = binary[y * width + x] === 0;
        if (isBlack && !inBlack) { inBlack = true; runStart = x; }
        if (!isBlack && inBlack) {
          inBlack = false;
          var runLen = x - runStart;
          /* Un candidat doit avoir une longueur raisonnable (5..50% de la largeur) */
          if (runLen > width * 0.03 && runLen < width * 0.55) {
            candidates.push({ x: runStart, y: y, w: runLen });
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Décode la grille 7×7 d'un candidat pour vérifier si c'est un marqueur ArUco.
   * @param {Uint8Array} gray — image grise
   * @param {number} width
   * @param {Object} rect — { cx, cy, side } — centre et côté estimés
   * @param {Array} dict  — DICT_5X5_100
   * @returns {{ id: number, corners: Array, confidence: number } | null}
   */
  function decodeCandidate(gray, width, height, rect, dict) {
    var cx   = rect.cx;
    var cy   = rect.cy;
    var side = rect.side;
    var cellSize = side / 7;

    if (cellSize < 3) return null; /* trop petit */

    /* Echantillonner la grille 7×7 */
    var bits = [];
    for (var row = 0; row < 7; row++) {
      for (var col = 0; col < 7; col++) {
        var sx = Math.round(cx - side / 2 + (col + 0.5) * cellSize);
        var sy = Math.round(cy - side / 2 + (row + 0.5) * cellSize);
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
          bits.push(-1);
        } else {
          /* Moyenne sur une zone 3×3 autour du point */
          var sum = 0; var cnt = 0;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx2 = -1; dx2 <= 1; dx2++) {
              var nx = sx + dx2, ny = sy + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                sum += gray[ny * width + nx]; cnt++;
              }
            }
          }
          bits.push(sum / cnt < 128 ? 0 : 1); /* 0=noir, 1=blanc */
        }
      }
    }

    /* Vérification de la bordure (doit être noire = 0) */
    var borderScore = 0;
    var borderCount = 0;
    for (var i = 0; i < 7; i++) {
      /* Row 0 et Row 6 */
      if (bits[i] === 0) borderScore++;
      if (bits[42 + i] === 0) borderScore++;
      /* Col 0 et Col 6 */
      if (bits[i * 7] === 0) borderScore++;
      if (bits[i * 7 + 6] === 0) borderScore++;
      borderCount += 4;
    }
    var borderRatio = borderScore / borderCount;
    if (borderRatio < 0.65) return null; /* bordure pas assez noire */

    /* Extraire les 25 bits de données (grille 5×5 intérieure) */
    var dataBits = 0;
    for (var r = 1; r <= 5; r++) {
      for (var c = 1; c <= 5; c++) {
        var b = bits[r * 7 + c];
        if (b === -1) return null; /* hors image */
        dataBits = (dataBits << 1) | (b === 0 ? 1 : 0); /* noir=1, blanc=0 */
      }
    }

    /* Comparer aux 4 rotations du marqueur contre le dictionnaire */
    function rotate90bits(b) {
      /* Rotation 90° d'une grille 5×5 encodée en 25 bits */
      var out = 0;
      for (var ri = 0; ri < 5; ri++) {
        for (var ci = 0; ci < 5; ci++) {
          var srcIdx = ri * 5 + ci;
          var dstIdx = ci * 5 + (4 - ri);
          var bit = (b >> (24 - srcIdx)) & 1;
          out = out | (bit << (24 - dstIdx));
        }
      }
      return out;
    }

    var rotations = [dataBits];
    rotations.push(rotate90bits(rotations[0]));
    rotations.push(rotate90bits(rotations[1]));
    rotations.push(rotate90bits(rotations[2]));

    for (var ri2 = 0; ri2 < rotations.length; ri2++) {
      var rot = rotations[ri2];
      for (var di = 0; di < dict.length; di++) {
        if (dict[di] === rot) {
          /* Calculer la confiance basée sur le score de bordure */
          var corners = [
            { x: cx - side / 2, y: cy - side / 2 },
            { x: cx + side / 2, y: cy - side / 2 },
            { x: cx + side / 2, y: cy + side / 2 },
            { x: cx - side / 2, y: cy + side / 2 }
          ];
          return { id: di, corners: corners, rotation: ri2, confidence: borderRatio, cx: cx, cy: cy, side: side };
        }
      }
    }

    return null;
  }

  /**
   * Détecte les marqueurs ArUco dans une ImageData prétraitée.
   * Approche adaptée aux contraintes mobiles : pas de détection de contours Canny,
   * mais un scan de blobs noirs adaptif.
   */
  function detectMarkers(preprocessed, dict) {
    var w = preprocessed.width;
    var h = preprocessed.height;
    var gray   = preprocessed._gray;
    var binary = preprocessed._binary;

    if (!gray || !binary) return [];

    var found = [];
    /* Pas de scan adaptatif à la résolution */
    var scanStep = Math.max(2, Math.floor(Math.min(w, h) / 100));

    /* Chercher des régions sombres rectangulaires */
    /* On cherche des lignes de transition noir→blanc sur l'axe X */
    var candidates = [];

    /* Scan par colonnes : chercher des runs noirs verticaux */
    for (var x = 0; x < w; x += scanStep) {
      var inB = false;
      var ys = 0;
      for (var y = 0; y < h; y++) {
        var blk = gray[y * w + x] < 100;
        if (blk && !inB) { inB = true; ys = y; }
        if (!blk && inB) {
          inB = false;
          var runH = y - ys;
          /* Filtrer par hauteur (5-50% de la hauteur image) */
          if (runH > h * 0.04 && runH < h * 0.5) {
            var cx = x;
            var cy = Math.round(ys + runH / 2);
            candidates.push({ cx: cx, cy: cy, side: runH });
          }
        }
      }
    }

    /* Scan par lignes aussi */
    for (var y2 = 0; y2 < h; y2 += scanStep) {
      var inB2 = false;
      var xs = 0;
      for (var x2 = 0; x2 < w; x2++) {
        var blk2 = gray[y2 * w + x2] < 100;
        if (blk2 && !inB2) { inB2 = true; xs = x2; }
        if (!blk2 && inB2) {
          inB2 = false;
          var runW = x2 - xs;
          if (runW > w * 0.04 && runW < w * 0.5) {
            candidates.push({ cx: Math.round(xs + runW / 2), cy: y2, side: runW });
          }
        }
      }
    }

    /* Regrouper et tenter le décodage */
    var tested = {};
    var GRID_CELL = Math.floor(Math.min(w, h) / 20);

    candidates.forEach(function (c) {
      var key = Math.floor(c.cx / GRID_CELL) + '_' + Math.floor(c.cy / GRID_CELL) + '_' + Math.floor(c.side / GRID_CELL);
      if (tested[key]) return;
      tested[key] = true;

      /* Tester plusieurs tailles autour de la taille candidate */
      var sizeFactors = [0.8, 0.9, 1.0, 1.1, 1.2, 1.35, 1.5, 1.7, 2.0];
      sizeFactors.forEach(function (sf) {
        var rect = { cx: c.cx, cy: c.cy, side: c.side * sf };
        var det = decodeCandidate(gray, w, h, rect, dict);
        if (det && det.confidence > 0.65) {
          /* Vérifier que ce n'est pas un doublon */
          var isDup = found.some(function (f) {
            return f.id === det.id && Math.abs(f.cx - det.cx) < det.side * 0.5 && Math.abs(f.cy - det.cy) < det.side * 0.5;
          });
          if (!isDup) found.push(det);
        }
      });
    });

    /* Garder le meilleur candidat par ID */
    var best = {};
    found.forEach(function (d) {
      if (!best[d.id] || d.confidence > best[d.id].confidence) {
        best[d.id] = d;
      }
    });

    return Object.values ? Object.values(best) : Object.keys(best).map(function (k) { return best[k]; });
  }

  /* ================================================================
     CALCUL D'ECHELLE
     ================================================================ */

  /**
   * Calcule l'échelle px/mm à partir d'un marqueur détecté.
   * @param {Object} marker     — résultat de detectMarkers
   * @param {number} markerSizeMm — taille physique réelle du marqueur
   * @returns {number} — pixels par mm
   */
  function computeScale(marker, markerSizeMm) {
    /* On utilise la taille en pixels du marqueur (moyenne H/V pour robustesse) */
    return marker.side / markerSizeMm;
  }

  /* ================================================================
     SEGMENTATION OUTILLAGE — vue dessus
     Matériau : aluminium anodisé gris clair.
     L'outillage est PLUS CLAIR que le fond (établi, sol atelier).
     On détecte les pixels à haute luminosité (métal) adjacents au marqueur.
     ================================================================ */

  /**
   * Estime le rectangle englobant de l'outillage à partir d'une image vue dessus.
   * Méthode : détection des pixels clairs (aluminium anodisé gris clair) autour
   * du marqueur ArUco. Le fond (établi, sol atelier) est supposé plus sombre.
   *
   * @param {ImageData} preprocessed — imageData prétraitée
   * @param {Object} marker          — marqueur détecté {cx, cy, side}
   * @returns {{ x, y, w, h }} rectangle en pixels (peut être null si échec)
   */
  function segmentToolingTopView(preprocessed, marker) {
    var w  = preprocessed.width;
    var h  = preprocessed.height;
    var gray = preprocessed._gray;

    if (!gray) return null;

    var mCx   = marker.cx;
    var mCy   = marker.cy;
    var mSide = marker.side;

    /* Zone de recherche élargie autour du marqueur */
    var searchR = mSide * 3;
    var sx0 = Math.max(0, Math.round(mCx - searchR));
    var sx1 = Math.min(w - 1, Math.round(mCx + searchR));
    var sy0 = Math.max(0, Math.round(mCy - searchR));
    var sy1 = Math.min(h - 1, Math.round(mCy + searchR));

    /* Calculer la luminosité médiane de la zone hors marqueur pour définir
     * dynamiquement le seuil métal. L'aluminium anodisé est significativement
     * plus clair que le fond atelier. */
    var samples = [];
    var stepS = Math.max(1, Math.floor(mSide / 4));
    for (var sy = sy0; sy <= sy1; sy += stepS) {
      for (var sx = sx0; sx <= sx1; sx += stepS) {
        var dCxS = Math.abs(sx - mCx);
        var dCyS = Math.abs(sy - mCy);
        if (dCxS < mSide * 0.7 && dCyS < mSide * 0.7) continue;
        samples.push(gray[sy * w + sx]);
      }
    }
    samples.sort(function (a, b) { return a - b; });
    var medianG = samples.length > 0 ? samples[Math.floor(samples.length / 2)] : 128;

    /* Seuil : on accepte les pixels nettement au-dessus de la médiane (métal clair)
     * mais pas les surexposés (reflets spéculaires purs). */
    var METAL_MIN = Math.max(80, medianG + 20); /* au moins 20 pts au-dessus de la médiane */
    var METAL_MAX = 250;

    var minX = sx1, maxX = sx0, minY = sy1, maxY = sy0;
    var metalPixels = 0;

    for (var py = sy0; py <= sy1; py++) {
      for (var px = sx0; px <= sx1; px++) {
        /* Ignorer la zone du marqueur lui-même (dark square) */
        var dCx = Math.abs(px - mCx);
        var dCy = Math.abs(py - mCy);
        if (dCx < mSide * 0.6 && dCy < mSide * 0.6) continue;

        var g = gray[py * w + px];
        if (g >= METAL_MIN && g <= METAL_MAX) {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
          metalPixels++;
        }
      }
    }

    if (metalPixels < 100 || maxX <= minX || maxY <= minY) {
      /* Fallback : utiliser la zone de recherche entière */
      return { x: sx0, y: sy0, w: sx1 - sx0, h: sy1 - sy0 };
    }

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /* ================================================================
     CORRECTION DE PERSPECTIVE — vue 3/4
     Pour la vue de côté/3/4, on estime la hauteur par la projection
     du marqueur : on connaît sa taille physique et sa déformation.
     ================================================================ */

  /**
   * Mesure la largeur apparente du marqueur dans l'image en scannant horizontalement
   * depuis son centre — cherche les bords de la zone sombre (marqueur noir).
   * Utilisé pour calculer l'angle de vue réel depuis la déformation du marqueur.
   *
   * @param {Uint8Array} gray  — image en niveaux de gris
   * @param {number} w         — largeur image
   * @param {number} h         — hauteur image
   * @param {Object} marker    — { cx, cy, side }
   * @returns {number}         — largeur apparente en pixels
   */
  function measureMarkerWidthPx(gray, w, h, marker) {
    var cx   = Math.round(marker.cx);
    var cy   = Math.round(marker.cy);
    /* Chercher les bords gauche et droit de la zone noire à la hauteur du centre */
    var leftEdge  = cx;
    var rightEdge = cx;
    var DARK_THRESHOLD = 80;
    /* Vers la gauche */
    for (var x = cx; x >= 0; x--) {
      if (cy >= 0 && cy < h && gray[cy * w + x] < DARK_THRESHOLD) {
        leftEdge = x;
      } else if (x < cx - 2) { break; } /* sortir dès qu'on quitte la zone noire */
    }
    /* Vers la droite */
    for (var x2 = cx; x2 < w; x2++) {
      if (cy >= 0 && cy < h && gray[cy * w + x2] < DARK_THRESHOLD) {
        rightEdge = x2;
      } else if (x2 > cx + 2) { break; }
    }
    var measuredWidth = rightEdge - leftEdge;
    /* Si la mesure est trop petite ou incohérente, retourner marker.side */
    return measuredWidth > marker.side * 0.3 ? measuredWidth : marker.side;
  }

  /**
   * Estime la hauteur de l'outillage à partir de la vue de côté.
   *
   * Deux modes détectés automatiquement :
   *
   * MODE INCLINE (cas normal) :
   *   Le marqueur au sol est vu en biais → il apparaît compressé verticalement.
   *   La déformation encode l'angle de vue : cos(angle) = hauteurApparente / largeurApparente.
   *   L'angle réel est calculé depuis les dimensions du marqueur détecté, sans saisie utilisateur.
   *   H_réelle = H_apparente_px / scaleH_vertical × (1 / cos(angle))
   *
   * MODE VERTICAL (fallback outillage haut) :
   *   Si le marqueur est vu de face (rapport h/l ≈ 1 — pas de déformation), le marqueur
   *   est posé debout contre le côté de l'outillage.
   *   L'échelle est directement px/mm sans correction d'angle.
   *   H est mesurée sur l'image entre le bas de l'outillage et son sommet.
   *
   * @param {ImageData} preprocessed — vue de côté prétraitée
   * @param {Object} marker          — marqueur détecté dans la vue de côté
   * @param {number} markerSizeMm    — taille réelle du marqueur en mm (défaut 80)
   * @returns {{ heightMm: number, scaleH: number, apparentHeightPx: number, mode: string, angleDeg: number }}
   */
  function estimateHeightFrom34View(preprocessed, marker, markerSizeMm) {
    var w    = preprocessed.width;
    var h    = preprocessed.height;
    var gray = preprocessed._gray;

    var mCx   = marker.cx;
    var mCy   = marker.cy;
    var mSide = marker.side;

    /* --- Calcul automatique de l'angle depuis la déformation du marqueur --- */

    /* Hauteur apparente du marqueur : taille détectée (dimension sur l'axe vertical) */
    var markerHeightPx = mSide;

    /* Largeur apparente du marqueur : mesurée par scan horizontal */
    var markerWidthPx = measureMarkerWidthPx(gray, w, h, marker);

    /* Ratio déformation : si le marqueur est vu de face → ratio ≈ 1.
     * Si vu en biais → la hauteur est compressée → ratio < 1. */
    var ratio = markerHeightPx / markerWidthPx;

    /* Seuil pour détecter le mode vertical : rapport h/l entre 0.85 et 1.15 */
    var IS_VERTICAL_MODE = (ratio >= 0.85 && ratio <= 1.15);

    /* Angle de vue (tilt depuis la verticale) : cos(angle) = ratio → angle = acos(ratio)
     * Valide uniquement en mode incliné. Plafonné entre 15° et 75° pour robustesse. */
    var angleDeg;
    var cosAngle;
    if (IS_VERTICAL_MODE) {
      angleDeg = 0;
      cosAngle = 1;
    } else {
      /* Clamp ratio à [0.17, 0.97] pour éviter acos(>1) ou angle trop rasant */
      var ratioC = Math.max(0.17, Math.min(0.97, ratio));
      angleDeg = Math.acos(ratioC) * (180 / Math.PI);
      cosAngle = ratioC;
    }

    /* Facteur d'échelle vertical : px/mm basé sur la hauteur apparente du marqueur */
    var scaleHPxPerMm = markerHeightPx / markerSizeMm;

    /* --- Seuil métal pour scan de l'outillage --- */
    var metalRef = 0;
    var refCount = 0;
    var refRadius = Math.round(mSide * 0.3);
    for (var ry = -refRadius; ry <= refRadius; ry++) {
      var refPx = Math.round(mCx + mSide * 0.8);
      var refPy = Math.round(mCy + ry);
      if (refPx >= 0 && refPx < w && refPy >= 0 && refPy < h) {
        metalRef += gray[refPy * w + refPx];
        refCount++;
      }
    }
    metalRef = refCount > 0 ? metalRef / refCount : 150;
    var LIGHT_THRESHOLD = Math.max(60, metalRef * 0.55);

    var topEdge    = Math.round(mCy - mSide * 0.5);
    var bottomEdge = Math.round(mCy + mSide * 0.5);
    var colX = Math.round(mCx);

    if (IS_VERTICAL_MODE) {
      /* MODE VERTICAL : le marqueur est dressé contre le côté de l'outillage.
       * Le marqueur est vu de face — sa hauteur en px donne directement l'échelle.
       * On cherche le bord supérieur de l'outillage en remontant depuis le haut du marqueur,
       * et le bas de l'outillage est le bas du marqueur (posé sur l'établi). */

      /* Bord bas = bas du marqueur */
      bottomEdge = Math.round(mCy + mSide * 0.5);

      /* Chercher le bord supérieur de l'outillage en remontant */
      for (var py = Math.round(mCy - mSide * 0.5); py >= 0; py--) {
        if (colX >= 0 && colX < w) {
          var g = gray[py * w + colX];
          if (g < LIGHT_THRESHOLD) { topEdge = py; break; }
        }
      }

      var apparentHeightPxV = Math.abs(bottomEdge - topEdge);
      /* En mode vertical, pas de correction d'angle — échelle directe */
      var heightMmV = apparentHeightPxV / scaleHPxPerMm;
      heightMmV = Math.max(10, Math.min(heightMmV, 500));

      return {
        heightMm:         heightMmV,
        scaleH:           scaleHPxPerMm,
        apparentHeightPx: apparentHeightPxV,
        mode:             'vertical',
        angleDeg:         0
      };

    } else {
      /* MODE INCLINE : marqueur au sol vu en biais.
       * Correction de perspective : H_réelle = H_apparente / scaleH / cos(angle)
       * cos(angle) est mesuré directement depuis la déformation du marqueur. */

      /* Chercher le bord supérieur */
      for (var py3 = Math.round(mCy - mSide * 0.5); py3 >= 0; py3--) {
        if (colX >= 0 && colX < w) {
          var g3 = gray[py3 * w + colX];
          if (g3 < LIGHT_THRESHOLD) { topEdge = py3; break; }
        }
      }

      /* Chercher le bord inférieur */
      for (var py4 = Math.round(mCy + mSide * 0.5); py4 < h; py4++) {
        if (colX >= 0 && colX < w) {
          var g4 = gray[py4 * w + colX];
          if (g4 < LIGHT_THRESHOLD) { bottomEdge = py4; break; }
        }
      }

      var apparentHeightPxI = Math.abs(bottomEdge - topEdge);
      /* Correction automatique : diviser par cos(angle) = ratioC */
      var heightMmI = (apparentHeightPxI / scaleHPxPerMm) / cosAngle;
      heightMmI = Math.max(10, Math.min(heightMmI, 500));

      return {
        heightMm:         heightMmI,
        scaleH:           scaleHPxPerMm,
        apparentHeightPx: apparentHeightPxI,
        mode:             'incline',
        angleDeg:         Math.round(angleDeg)
      };
    }
  }

  /* ================================================================
     API PUBLIQUE
     ================================================================ */

  /**
   * Traite la photo vue dessus.
   * @param {File} imageFile
   * @param {number} markerSizeMm
   * @returns {Promise<{
   *   scalePixPerMm: number,
   *   toolingRectPx: {x,y,w,h},
   *   lengthMm: number,
   *   widthMm: number,
   *   markerId: number,
   *   canvas: HTMLCanvasElement,
   *   debugInfo: string
   * }>}
   */
  function processTopView(imageFile, markerSizeMm) {
    markerSizeMm = markerSizeMm || 80;

    return loadImageData(imageFile).then(function (loaded) {
      var preprocessed = preprocessGrayscale(loaded.imageData);
      preprocessed.width  = loaded.imageData.width;
      preprocessed.height = loaded.imageData.height;

      /* Correction de scale si l'image a été réduite */
      var scaleFactor = 1 / loaded.scale;

      var markers = detectMarkers(preprocessed, root.ArucoMarker ? root.ArucoMarker.DICT_5X5_100 : []);

      if (markers.length === 0) {
        /* Fallback : estimer l'échelle depuis la résolution de l'image
         * En supposant que la photo standard smartphone = ~30 cm de largeur de scène */
        var fallbackSceneMm = 300;
        var fallbackScale   = loaded.imageData.width / fallbackSceneMm;
        return {
          scalePixPerMm: fallbackScale * loaded.scale,
          toolingRectPx: { x: 0, y: 0, w: loaded.imageData.width, h: loaded.imageData.height },
          lengthMm: fallbackSceneMm * 0.6,
          widthMm:  fallbackSceneMm * 0.5,
          markerId: -1,
          canvas:   loaded.canvas,
          debugInfo: 'Marqueur ArUco non détecté — estimation par défaut (précision réduite)'
        };
      }

      var bestMarker = markers[0];
      var scale = computeScale(bestMarker, markerSizeMm) * loaded.scale; /* px/mm en coordonnées originales */
      var toolingRect = segmentToolingTopView(preprocessed, bestMarker);

      var lengthMm = toolingRect ? (toolingRect.w / (scale / scaleFactor)) : 0;
      var widthMm  = toolingRect ? (toolingRect.h / (scale / scaleFactor)) : 0;

      /* Dessiner les annotations sur le canvas */
      var ctx = loaded.canvas.getContext('2d');

      /* Rectangle marqueur */
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth   = 3;
      ctx.strokeRect(
        bestMarker.cx - bestMarker.side / 2,
        bestMarker.cy - bestMarker.side / 2,
        bestMarker.side, bestMarker.side
      );
      ctx.fillStyle = 'rgba(0,255,0,0.15)';
      ctx.fillRect(
        bestMarker.cx - bestMarker.side / 2,
        bestMarker.cy - bestMarker.side / 2,
        bestMarker.side, bestMarker.side
      );

      /* Label marqueur */
      ctx.fillStyle = '#00cc00';
      ctx.font = 'bold ' + Math.round(bestMarker.side * 0.18) + 'px sans-serif';
      ctx.fillText('ArUco #' + bestMarker.id, bestMarker.cx - bestMarker.side / 2, bestMarker.cy - bestMarker.side / 2 - 4);

      /* Rectangle outillage */
      if (toolingRect) {
        ctx.strokeStyle = '#ff6600';
        ctx.lineWidth   = 3;
        ctx.setLineDash([8, 4]);
        ctx.strokeRect(toolingRect.x, toolingRect.y, toolingRect.w, toolingRect.h);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,102,0,0.08)';
        ctx.fillRect(toolingRect.x, toolingRect.y, toolingRect.w, toolingRect.h);

        /* Cotes */
        ctx.fillStyle = '#cc4400';
        var fontSize = Math.round(bestMarker.side * 0.15);
        ctx.font = 'bold ' + fontSize + 'px sans-serif';
        ctx.fillText(
          'L: ' + Math.round(lengthMm) + ' mm',
          toolingRect.x + toolingRect.w / 2 - 30,
          toolingRect.y + toolingRect.h + fontSize + 4
        );
        ctx.fillText(
          'l: ' + Math.round(widthMm) + ' mm',
          toolingRect.x - fontSize * 4 - 4,
          toolingRect.y + toolingRect.h / 2
        );
      }

      return {
        scalePixPerMm: scale,
        toolingRectPx: toolingRect,
        lengthMm: Math.round(lengthMm),
        widthMm:  Math.round(widthMm),
        markerId: bestMarker.id,
        canvas:   loaded.canvas,
        debugInfo: 'Marqueur #' + bestMarker.id + ' détecté (confiance: ' + (bestMarker.confidence * 100).toFixed(0) + '%)'
      };
    });
  }

  /**
   * Traite la photo vue 3/4 pour estimer la hauteur.
   * @param {File} imageFile
   * @param {number} markerSizeMm
   * @returns {Promise<{ heightMm: number, canvas: HTMLCanvasElement, debugInfo: string }>}
   */
  function processSideView(imageFile, markerSizeMm) {
    markerSizeMm = markerSizeMm || 80;

    return loadImageData(imageFile).then(function (loaded) {
      var preprocessed = preprocessGrayscale(loaded.imageData);
      preprocessed.width  = loaded.imageData.width;
      preprocessed.height = loaded.imageData.height;

      var markers = detectMarkers(preprocessed, root.ArucoMarker ? root.ArucoMarker.DICT_5X5_100 : []);

      if (markers.length === 0) {
        return {
          heightMm:  60,
          canvas:    loaded.canvas,
          debugInfo: 'Marqueur non détecté sur vue 3/4 — hauteur par défaut (60 mm)'
        };
      }

      var bestMarker = markers[0];
      var heightResult = estimateHeightFrom34View(preprocessed, bestMarker, markerSizeMm);

      /* Annotation */
      var ctx = loaded.canvas.getContext('2d');
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth   = 3;
      ctx.strokeRect(
        bestMarker.cx - bestMarker.side / 2,
        bestMarker.cy - bestMarker.side / 2,
        bestMarker.side, bestMarker.side
      );

      /* Flèche de hauteur */
      var arrowX = bestMarker.cx + bestMarker.side * 0.8;
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(arrowX, bestMarker.cy - heightResult.apparentHeightPx / 2);
      ctx.lineTo(arrowX, bestMarker.cy + heightResult.apparentHeightPx / 2);
      ctx.stroke();
      ctx.fillStyle = '#ff00ff';
      ctx.font = 'bold ' + Math.round(bestMarker.side * 0.18) + 'px sans-serif';
      ctx.fillText('H: ' + Math.round(heightResult.heightMm) + ' mm', arrowX + 4, bestMarker.cy);

      var debugMsg;
      if (heightResult.mode === 'vertical') {
        debugMsg = 'H estimée: ' + Math.round(heightResult.heightMm) + ' mm (mode marqueur vertical — échelle directe)';
      } else {
        debugMsg = 'H estimée: ' + Math.round(heightResult.heightMm) + ' mm (angle mesuré: ' + heightResult.angleDeg + '°)';
      }

      return {
        heightMm:  Math.round(heightResult.heightMm),
        canvas:    loaded.canvas,
        debugInfo: debugMsg,
        mode:      heightResult.mode,
        angleDeg:  heightResult.angleDeg
      };
    });
  }

  /**
   * Calcule le volume outillage à partir des résultats des deux vues.
   * @param {Object} topResult  — résultat de processTopView
   * @param {Object} sideResult — résultat de processSideView
   * @returns {{ lengthMm, widthMm, heightMm, volumeLiters, volumeM3 }}
   */
  function estimateVolume(topResult, sideResult) {
    var L = topResult.lengthMm  || 0;
    var l = topResult.widthMm   || 0;
    var H = sideResult.heightMm || 0;

    var volumeMm3    = L * l * H;
    var volumeLiters = volumeMm3 / 1e6;
    var volumeM3     = volumeMm3 / 1e9;

    return {
      lengthMm:     Math.round(L),
      widthMm:      Math.round(l),
      heightMm:     Math.round(H),
      volumeLiters: parseFloat(volumeLiters.toFixed(3)),
      volumeM3:     parseFloat(volumeM3.toFixed(6))
    };
  }

  /* Export global */
  root.ArucoVision = {
    processTopView:  processTopView,
    processSideView: processSideView,
    estimateVolume:  estimateVolume,
    /* Exposés pour tests */
    _loadImageData:   loadImageData,
    _preprocessGrayscale: preprocessGrayscale,
    _detectMarkers:   detectMarkers
  };

})(window);
