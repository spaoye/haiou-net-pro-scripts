/*
 * 海鸥 Net（lfb.com.Netlight）v3.1 —— verifyReceipt 重写
 *
 * 逆向依据（主二进制 lfb.com.Netlight v3.1，arm64）：
 *   0x100019580  读 appStoreReceiptURL → base64
 *   0x1000195c4  stringWithFormat:@"{\"receipt-data\" : \"%@\"}"
 *   0x100019600  POST https://buy.itunes.apple.com/verifyReceipt
 *   0x1000196a4  NSJSONSerialization 解析响应
 *   0x1000196e4  objectForKey:@"receipt"    ← 取不到直接失败
 *   0x1000196fc  objectForKey:@"in_app"     ← 遍历数组
 *   0x100019730  objectForKey:@"product_id" ← 与本地已购 SKU 比对
 *   命中 → setHasBuyFlowDataShow:YES → updateUIForPurchasedState 解锁
 *   沙盒分支 @0x10005ce2c 逻辑相同，改打 sandbox.itunes.apple.com
 *
 * 结论：只要 status + receipt + in_app[].product_id 可控，App 就认为已购买。
 * product_id 由服务端下发、包里没有硬编码，因此脚本沿用真实响应里的 pid，
 * 拿不到就用候选集合兜底（App 的比对是 contains，多给几个不会出错）。
 */

var SKU_HINTS = [
  "com.lfb.netlight.vip.lifetime",
  "com.lfb.netlight.pro.lifetime",
  "com.lfb.netlight.vip",
  "com.lfb.netlight.pro",
  "com.netlight.vip.lifetime",
  "com.netlight.lifetime",
  "lfb.netlight.vip.lifetime",
  "netlight_vip_lifetime",
  "netlight.lifetime",
  "vip_lifetime",
  "lifetime_vip",
  "vip",
  "pro",
  "lifetime",
  "unlock"
];

function oneItem(pid) {
  return {
    quantity: "1",
    product_id: pid,
    transaction_id: "2000000000000001",
    original_transaction_id: "2000000000000001",
    purchase_date: "2024-01-01 00:00:00 Etc/GMT",
    purchase_date_ms: "1704067200000",
    purchase_date_pst: "2023-12-31 16:00:00 America/Los_Angeles",
    original_purchase_date: "2024-01-01 00:00:00 Etc/GMT",
    original_purchase_date_ms: "1704067200000",
    is_trial_period: "false",
    is_in_intro_offer_period: "false",
    in_app_ownership_type: "PURCHASED"
  };
}

// 插件参数里用户填的真实 product_id（优先级最高，填了就排在最前）
function argPids() {
  var out = [];
  try {
    if (typeof $argument === "undefined" || $argument === null) return out;
    var raw = "";
    if (typeof $argument === "string") raw = $argument;
    else if (typeof $argument === "object" && $argument.pid_tips) raw = String($argument.pid_tips);
    raw.split(",").forEach(function (x) {
      x = x.trim();
      if (x && out.indexOf(x) < 0) out.push(x);
    });
  } catch (e) {}
  return out;
}

function collectPids(body) {
  var out = argPids();
  function add(x) { if (x && out.indexOf(x) < 0) out.push(String(x)); }
  try {
    var j = JSON.parse(body || "{}");
    if (j && j.receipt && j.receipt.in_app instanceof Array) {
      j.receipt.in_app.forEach(function (o) { if (o) add(o.product_id); });
    }
    if (j && j.latest_receipt_info instanceof Array) {
      j.latest_receipt_info.forEach(function (o) { if (o) add(o.product_id); });
    }
  } catch (e) {}
  if (!out.length) out = SKU_HINTS.slice(0);
  else {
    // 真实/用户填的 pid 在前，候选集合补在后面
    SKU_HINTS.forEach(add);
  }
  return out;
}

function buildBody(origBody, url) {
  var env = String(url).indexOf("sandbox") >= 0 ? "Sandbox" : "Production";
  var items = collectPids(origBody).map(oneItem);
  return JSON.stringify({
    status: 0,
    environment: env,
    receipt: {
      bundle_id: "lfb.com.Netlight",
      application_version: "3.1",
      in_app: items
    },
    latest_receipt_info: items,
    pending_renewal_info: [],
    "is-retryable": false
  });
}

function onResponse(req, resp) {
  return {
    status: 200,
    headers: Object.assign({}, (resp && resp.headers) || {}, { "Content-Type": "application/json" }),
    body: buildBody((resp && resp.body) || "", (req && req.url) || "")
  };
}

if (typeof $done === "function" && typeof $response !== "undefined") {
  $done(onResponse($request, $response));
}

global.__loaded=$done; module.exports={onResponse:onResponse,buildBody:buildBody,collectPids:collectPids};
