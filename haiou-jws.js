/*
 * 海鸥 Net（lfb.com.Netlight）—— 新版 JWS 收据校验重写
 *
 * Apple 已把 verifyReceipt 迁到 verifyReceiptJws（返回 signedTransactionInfo /
 * signedRenewalInfo 的 JWS）。App 解析后仍是看「有没有已购 SKU」，
 * 所以这里给一个签名段随便填、payload 写死「已购买」的 JWS。
 * 若 App 版本做了本地 JWS 验签（clientVerification），本脚本将无效 —— 以实际抓包为准。
 */

var SKU_HINTS = [
  "com.lfb.netlight.vip.lifetime",
  "com.lfb.netlight.pro.lifetime",
  "com.lfb.netlight.vip",
  "com.lfb.netlight.pro",
  "com.netlight.vip.lifetime",
  "vip_lifetime",
  "lifetime_vip"
];

function b64url(str) {
  var s = "";
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i).toString(16);
    s += "%" + (c.length < 2 ? "0" + c : c);
  }
  return decodeURIComponent(s)
    .split("")
    .map(function (ch) { return String.fromCharCode(ch.charCodeAt(0)); })
    .join("");
}

function b64urlEncode(obj) {
  var json = JSON.stringify(obj);
  var utf8 = unescape(encodeURIComponent(json));
  var b64 = (typeof btoa === "function")
    ? btoa(utf8)
    : Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function payloadFor(pid, env) {
  var now = Date.now();
  return {
    originalTransactionId: "2000000000000001",
    transactionId: "2000000000000001",
    webOrderLineItemId: "2000000000000001",
    bundleId: "lfb.com.Netlight",
    productId: pid,
    purchaseDate: now - 86400000,
    originalPurchaseDate: now - 86400000,
    expiresDate: null,
    quantity: 1,
    type: "Non-Consumable",
    inAppOwnershipType: "PURCHASED",
    signedDate: now,
    environment: env,
    transactionReason: "PURCHASE",
    storefront: "CHN",
    storefrontId: "143465"
  };
}

function onResponse(req, resp) {
  var url = String((req && req.url) || "");
  var env = url.indexOf("sandbox") >= 0 ? "Sandbox" : "Production";
  var pids = SKU_HINTS.slice(0);
  var txs = pids.map(function (pid) {
    return b64urlEncode({ alg: "ES256" }) + "." + b64urlEncode(payloadFor(pid, env)) + ".FAKE";
  });
  return {
    status: 200,
    headers: Object.assign({}, (resp && resp.headers) || {}, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      environment: env,
      bundleId: "lfb.com.Netlight",
      appAppleId: 1288011873,
      signedRenewalInfo: [],
      signedTransactionInfo: txs
    })
  };
}

if (typeof $done === "function" && typeof $response !== "undefined") {
  $done(onResponse($request, $response));
}

module.exports = { onResponse: onResponse };
