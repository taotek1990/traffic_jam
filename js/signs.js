(function () {
  'use strict';
  const TJ = window.TJ;

  const RED = '#d4181f';
  const BLUE = '#0c5aa6';
  const YEL = '#f6c90e';

  // slot: 'in' = po stronie najazdu na skrzyżowanie, 'out' = po stronie wyjazdu ze skrzyżowania
  TJ.SIGNS = [
    { id: 'yield', code: 'A-7', name: 'Ustąp pierwszeństwa', slot: 'in' },
    { id: 'stop', code: 'B-20', name: 'Stop', slot: 'in' },
    { id: 'priority', code: 'D-1', name: 'Droga z pierwszeństwem', slot: 'in' },
    { id: 'noentry', code: 'B-2', name: 'Zakaz wjazdu', slot: 'out' },
    { id: 'dirS', code: 'C-5', name: 'Nakaz jazdy prosto', slot: 'in' },
    { id: 'dirR', code: 'C-2', name: 'Nakaz jazdy w prawo', slot: 'in' },
    { id: 'dirL', code: 'C-3', name: 'Nakaz jazdy w lewo', slot: 'in' },
    { id: 'dirSR', code: 'C-6', name: 'Nakaz jazdy prosto lub w prawo', slot: 'in' },
    { id: 'dirSL', code: 'C-7', name: 'Nakaz jazdy prosto lub w lewo', slot: 'in' },
  ];
  TJ.SIGN_BY_ID = {};
  TJ.SIGNS.forEach((s) => (TJ.SIGN_BY_ID[s.id] = s));

  function blueDisc(ctx) {
    ctx.fillStyle = BLUE;
    ctx.beginPath();
    ctx.arc(0, 0, 48, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, 0, 44, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle = '#fff';
  }

  function arrowHead(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    ctx.lineTo(pts[2], pts[3]);
    ctx.lineTo(pts[4], pts[5]);
    ctx.closePath();
    ctx.fill();
  }

  function stroke(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
  }

  // rysuje znak o środku (x,y); size = szerokość w jednostkach płótna
  TJ.drawSign = function (ctx, id, x, y, size) {
    ctx.save();
    ctx.translate(x, y);
    const k = size / 100;
    ctx.scale(k, k);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    switch (id) {
      case 'yield': {
        const tri = () => {
          ctx.beginPath();
          ctx.moveTo(-46, -34);
          ctx.lineTo(46, -34);
          ctx.lineTo(0, 46);
          ctx.closePath();
        };
        ctx.fillStyle = ctx.strokeStyle = RED;
        ctx.lineWidth = 8;
        tri();
        ctx.fill();
        ctx.stroke();
        ctx.save();
        ctx.translate(0, -7.3);
        ctx.scale(0.6, 0.6);
        ctx.translate(0, 7.3);
        ctx.fillStyle = '#fff';
        tri();
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'stop': {
        const oct = (r) => {
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const a = (i * 45 + 22.5) * (Math.PI / 180);
            const px = Math.cos(a) * r, py = Math.sin(a) * r;
            if (i) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
          }
          ctx.closePath();
        };
        ctx.fillStyle = RED;
        oct(50);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3.5;
        oct(44);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 27px Arial, Helvetica, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('STOP', 0, 2);
        break;
      }
      case 'noentry': {
        ctx.fillStyle = RED;
        ctx.beginPath();
        ctx.arc(0, 0, 48, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(-33, -9.5, 66, 19);
        break;
      }
      case 'priority': {
        const dia = (r) => {
          ctx.beginPath();
          ctx.moveTo(0, -r);
          ctx.lineTo(r, 0);
          ctx.lineTo(0, r);
          ctx.lineTo(-r, 0);
          ctx.closePath();
        };
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#1b1b1b';
        ctx.lineWidth = 3;
        dia(50);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = YEL;
        dia(37);
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.stroke();
        break;
      }
      case 'dirS':
        blueDisc(ctx);
        ctx.lineWidth = 13;
        stroke(ctx, [0, 38, 0, -8]);
        arrowHead(ctx, [-25, -8, 25, -8, 0, -38]);
        break;
      case 'dirR':
      case 'dirL':
        blueDisc(ctx);
        if (id === 'dirL') ctx.scale(-1, 1);
        ctx.lineWidth = 13;
        stroke(ctx, [-14, 36, -14, -4, 8, -4]);
        arrowHead(ctx, [6, -25, 6, 17, 34, -4]);
        break;
      case 'dirSR':
      case 'dirSL':
        blueDisc(ctx);
        if (id === 'dirSL') ctx.scale(-1, 1);
        ctx.lineWidth = 12;
        stroke(ctx, [-10, 38, -10, -12]);
        arrowHead(ctx, [-30, -12, 10, -12, -10, -40]);
        stroke(ctx, [-10, 14, 8, 14]);
        arrowHead(ctx, [6, 0, 6, 28, 34, 14]);
        break;
    }
    ctx.restore();
  };
})();
