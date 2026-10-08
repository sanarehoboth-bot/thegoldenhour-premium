'use strict';
var API = 'https://api.gumroad.com/v2/licenses/verify';

var CONFIG = { PRODUCT_IDS: 'JBxm61TbS3NKHbz_z_ipiw==:15', TEST_KEYS: 'GIFT-TEST-7Q2K' };

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function normalize(k) {
  return String(k || '').toUpperCase().replace(/\s+/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-F-]/g, '');
}

function variants(id) {
  var swaps = { '1': '1lI', 'l': '1lI', 'I': '1lI', '0': '0O', 'O': '0O' };
  var out = [id], i, j, opts;
  for (i = 0; i < id.length; i++) {
    opts = swaps[id.charAt(i)];
    if (!opts) continue;
    for (j = 0; j < opts.length; j++) {
      if (opts.charAt(j) !== id.charAt(i)) out.push(id.slice(0, i) + opts.charAt(j) + id.slice(i + 1));
    }
  }
  return out;
}

function callGumroad(productId, key, increment) {
  var body = 'product_id=' + encodeURIComponent(productId) +
    '&license_key=' + encodeURIComponent(key) +
    '&increment_uses_count=' + (increment ? 'true' : 'false');
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      return { status: r.status, data: j };
    });
  });
}

module.exports = function (req, res) {
  var defCap = parseInt(process.env.MAX_USES || '3', 10);
  if (isNaN(defCap)) defCap = 3;
  var ids = String(process.env.GUMROAD_PRODUCT_IDS || CONFIG.PRODUCT_IDS || '').split(',')
    .map(function (s) { return s.trim(); }).filter(Boolean)
    .filter(function (s) { return s.indexOf('TO_BE_CREATED') === -1; })
    .map(function (e) {
      var p = e.split(':'), c = p.length > 1 ? parseInt(p[1], 10) : defCap;
      return { id: p[0].trim(), cap: isNaN(c) ? defCap : c };
    });
  var tk = String(process.env.TEST_KEYS || CONFIG.TEST_KEYS || '').split(',')
    .map(function (s) { return s.replace(/\s+/g, '').toUpperCase(); }).filter(Boolean);

  if (req.method === 'GET') return send(res, 200, { ok: true, products: ids.length, testMode: tk.length > 0 });
  if (req.method !== 'POST') return send(res, 405, { ok: false, code: 'method' });
  var body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  if (!ids.length && !tk.length) return send(res, 500, { ok: false, code: 'config' });

  var raw = String(body.key || '').replace(/\s+/g, '').toUpperCase();
  if (raw && tk.indexOf(raw) !== -1) return send(res, 200, { ok: true, key: raw });
  if (!ids.length) return send(res, 200, { ok: false, code: 'invalid' });

  var key = normalize(body.key);
  if (key.length < 20) return send(res, 200, { ok: false, code: 'invalid' });

  var list = [];
  ids.forEach(function (e) { variants(e.id).forEach(function (v) { list.push({ id: v, cap: e.cap }); }); });

  function tryId(i) {
    if (i >= list.length) return send(res, 200, { ok: false, code: 'invalid' });
    return callGumroad(list[i].id, key, false).then(function (r) {
      if (r.status === 404 || (r.data && r.data.success === false && r.status < 500)) return tryId(i + 1);
      if (r.status !== 200 || !r.data || r.data.success !== true) return send(res, 502, { ok: false, code: 'upstream' });
      var p = r.data.purchase || {};
      if (p.refunded || p.chargebacked || (p.disputed && !p.dispute_won)) {
        return send(res, 200, { ok: false, code: 'refunded' });
      }
      var uses = parseInt(r.data.uses || 0, 10) || 0;
      if (body.isNewDevice === true && body.deviceId) {
        if (list[i].cap > 0 && uses >= list[i].cap) return send(res, 200, { ok: false, code: 'limit' });
        return callGumroad(list[i].id, key, true).then(function () {
          return send(res, 200, { ok: true, key: key });
        });
      }
      return send(res, 200, { ok: true, key: key });
    });
  }

  tryId(0).catch(function () { send(res, 502, { ok: false, code: 'upstream' }); });
};
