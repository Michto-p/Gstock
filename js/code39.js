/* Gstock - code39.js v2.1.6 (renderer Code 39 en SVG) */
'use strict';
(function(){
  const MAP = {
    '0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw',
    '5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn',
    'A':'wnnnnwnnw','B':'nnwnnwnnw','C':'wnwnnwnnn','D':'nnnnwwnnw','E':'wnnnwwnnn',
    'F':'nnwnwwnnn','G':'nnnnnwwnw','H':'wnnnnwwnn','I':'nnwnnwwnn','J':'nnnnwwwnn',
    'K':'wnnnnnnww','L':'nnwnnnnww','M':'wnwnnnnwn','N':'nnnnwnnww','O':'wnnnwnnwn',
    'P':'nnwnwnnwn','Q':'nnnnnnwww','R':'wnnnnnwwn','S':'nnwnnnwwn','T':'nnnnwnwwn',
    'U':'wwnnnnnnw','V':'nwwnnnnnw','W':'wwwnnnnnn','X':'nwnnwnnnw','Y':'wwnnwnnnn',
    'Z':'nwwnwnnnn','-':'nwnnnnwnw','.':'wwnnnnwnn',' ':'nwwnnnwnn','*':'nwnnwnwnn',
    '$':'nwnwnwnnn','/':'nwnwnnnwn','+':'nwnnnwnwn','%':'nnnwnwnwn'
  };
  function svg(value, opts={}){
    const {module=2, height=40, margin=10, showText=true, fontSize=12} = opts;
    const data = `*${String(value).toUpperCase()}*`;
    const inter = module;
    let total = margin*2 + inter*(data.length-1);
    for(const ch of data){
      const p = MAP[ch];
      if(!p) throw new Error('Caractère non supporté: '+ch);
      for(const c of p) total += (c==='w'?3:1)*module;
    }
    const w = total, h = height + (showText?(fontSize+6):0);
    let x = margin;
    const svgns='http://www.w3.org/2000/svg';
    const s=document.createElementNS(svgns,'svg');
    s.setAttribute('width', String(w));
    s.setAttribute('height', String(h));
    s.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const g=document.createElementNS(svgns,'g'); s.appendChild(g);
    for(const ch of data){
      const pat = MAP[ch];
      for(let i=0;i<9;i++){
        const wide = pat[i]==='w';
        const ww = (wide?3:1)*module;
        if(i%2===0){ // bar
          const r=document.createElementNS(svgns,'rect');
          r.setAttribute('x', String(x));
          r.setAttribute('y', '0');
          r.setAttribute('width', String(ww));
          r.setAttribute('height', String(height));
          r.setAttribute('fill', '#111827');
          g.appendChild(r);
        }
        x += ww;
      }
      x += inter;
    }
    if(showText){
      const t=document.createElementNS(svgns,'text');
      t.setAttribute('x', String(w/2));
      t.setAttribute('y', String(height+fontSize));
      t.setAttribute('text-anchor','middle');
      t.setAttribute('font-family','ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
      t.setAttribute('font-size', String(fontSize));
      t.textContent = String(value);
      s.appendChild(t);
    }
    return s;
  }
  window.code39 = { svg };
})();
