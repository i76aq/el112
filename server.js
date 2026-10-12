const http = require('http');
const crypto = require('crypto');
const QRCode = require('qrcode');

// ====== الإعدادات: غيّر هنا أو من متغيرات البيئة ======
const GROUP_NAME = process.env.GROUP_NAME || 'el112';
const GROUP_LINK = process.env.GROUP_LINK || 'https://chat.whatsapp.com/HBlzgWU7pCRHdxn5rPc54U?s=cl&p=a&mlu=4&ilr=4';
const SECRET = process.env.SECRET || '3c7056a8c900f8ecd1c97027b87524d7e5a7e2200aa7c0bd';
const ROTATE_MS = Number(process.env.ROTATE_MS) || 2000;          // كل كم يتغير الـ QR
const QR_TTL_MS = Number(process.env.QR_TTL_MS) || 2000;          // صلاحية الـ QR
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 15000; // صلاحية الدخول للموقع
const PORT = process.env.PORT || 3000;
// =====================================================

const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex').slice(0, 32);
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const makeToken = () => { const ts = Date.now(); return `${ts}.${sign(`qr:${ts}`)}`; };
const checkToken = (t) => {
  const [ts, sig] = String(t || '').split('.');
  if (!ts || !sig || !safeEq(sig, sign(`qr:${ts}`))) return false;
  const age = Date.now() - Number(ts);
  return age >= 0 && age <= QR_TTL_MS;
};

const getCookie = (req, name) => {
  const m = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
};
const sessionRemaining = (req) => {
  const [exp, sig] = getCookie(req, 'sess').split('.');
  if (!exp || !sig || !safeEq(sig, sign(`sess:${exp}`))) return 0;
  return Math.max(0, Number(exp) - Date.now());
};

const page = (body) => `<!doctype html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(GROUP_NAME)}</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;background:#0f172a;color:#f1f5f9;text-align:center;padding:20px}
.card{background:#1e293b;border-radius:20px;padding:28px;max-width:420px;width:100%;box-shadow:0 10px 40px #0006}
h1{margin:0 0 6px;font-size:22px}p{color:#94a3b8;margin:6px 0 18px}
img{width:260px;max-width:100%;background:#fff;padding:10px;border-radius:12px}
.bar{height:6px;background:#334155;border-radius:3px;overflow:hidden;margin-top:16px}
.bar>i{display:block;height:100%;background:#22c55e;width:100%}
a.btn{display:block;background:#22c55e;color:#04210f;text-decoration:none;font-weight:700;padding:14px;border-radius:12px;margin:16px 0}
.t{font-size:40px;font-weight:800;color:#22c55e}.bad{color:#f87171}
</style></head><body><div class="card">${body}</div></body></html>`;

const send = (res, code, type, body, headers = {}) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;

  // صفحة العرض (على شاشة القاعة): QR يتجدد بدون توقف
  if (path === '/') {
    const ms = ROTATE_MS;
    return send(res, 200, 'text/html; charset=utf-8', page(`
      <h1>${esc(GROUP_NAME)}</h1><p>امسح الكود للانضمام</p>
      <img id="qr" alt="QR"><div class="bar"><i id="b"></i></div>
      <p id="n" style="font-size:13px;margin-top:12px"></p>
      <script>
        const img=document.getElementById('qr'),b=document.getElementById('b'),n=document.getElementById('n');
        let count=0;
        async function tick(){
          try{
            const r=await fetch('/qr.svg?'+Date.now(),{cache:'no-store'});
            if(!r.ok)throw 0;
            const url=URL.createObjectURL(await r.blob());
            const old=img.src;img.src=url;if(old.startsWith('blob:'))URL.revokeObjectURL(old);
            count++;n.textContent='تم تجديد الكود '+count+' مرة';
            b.style.transition='none';b.style.width='100%';
            requestAnimationFrame(()=>requestAnimationFrame(()=>{b.style.transition='width ${ms}ms linear';b.style.width='0'}));
          }catch(e){n.textContent='جاري إعادة المحاولة...'}
        }
        tick();setInterval(tick,${ms});
        document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});
      </script>`));
  }

  if (path === '/qr.svg') {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const target = `${proto}://${req.headers.host}/go?t=${makeToken()}`;
    const svg = await QRCode.toString(target, { type: 'svg', margin: 1, width: 260 });
    return send(res, 200, 'image/svg+xml', svg);
  }

  // عند مسح الـ QR: تحقق من التوكن وافتح جلسة 15 ثانية
  if (path === '/go') {
    if (!checkToken(url.searchParams.get('t'))) {
      return send(res, 403, 'text/html; charset=utf-8',
        page(`<h1 class="bad">انتهت صلاحية الكود</h1><p>امسح الكود الظاهر على الشاشة مرة ثانية.</p>`));
    }
    const exp = Date.now() + SESSION_TTL_MS;
    const cookie = `sess=${exp}.${sign(`sess:${exp}`)}; Path=/; Max-Age=${Math.ceil(SESSION_TTL_MS / 1000)}; HttpOnly; SameSite=Lax`;
    return send(res, 302, 'text/plain', '', { Location: '/join', 'Set-Cookie': cookie });
  }

  // صفحة رابط القروب (تنتهي بعد 15 ثانية)
  if (path === '/join') {
    const left = sessionRemaining(req);
    if (!left) {
      return send(res, 403, 'text/html; charset=utf-8',
        page(`<h1 class="bad">انتهت الجلسة</h1><p>امسح الـ QR مرة ثانية للدخول.</p>`));
    }
    return send(res, 200, 'text/html; charset=utf-8', page(`
      <h1>${esc(GROUP_NAME)}</h1><p>اضغط للانضمام قبل ما ينتهي الوقت</p>
      <div class="t" id="t">${Math.ceil(left / 1000)}</div>
      <a class="btn" href="${esc(GROUP_LINK)}">انظم للقروب</a>
      <div class="bar"><i id="b"></i></div>
      <script>
        const left=${left},end=Date.now()+left;
        const t=document.getElementById('t'),b=document.getElementById('b');
        b.style.transition='width '+left+'ms linear';requestAnimationFrame(()=>b.style.width='0');
        const iv=setInterval(()=>{const r=end-Date.now();
          if(r<=0){clearInterval(iv);location.reload();return}
          t.textContent=Math.ceil(r/1000)},200);
      </script>`));
  }

  send(res, 404, 'text/plain', 'Not found');
}).listen(PORT, () => console.log('Running on port ' + PORT));
