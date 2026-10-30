# 海鸥 Net v3.1 逆向分析报告（Pro 解锁点）

- 目标：`🄷🅆 Net_3.1.ipa`（重打包版，Esign 签名）
- Bundle ID：`lfb.com.Netlight`
- 主二进制：`Payload/NetworkSpeed.app/NetworkSpeed`（arm64，1.72 MB）
- 分析日期：2026-10-31
- 分析方式：静态（capstone 反汇编 + Mach-O 解析），未上真机

---

## 一、结论先行

**这个 App 没有任何服务端会员接口，Pro 解锁完全靠「本地校验 App Store 收据」。**

校验链路（全部在主二进制里）：

```
appStoreReceiptURL → base64 → {"receipt-data":"..."} 
        → POST buy.itunes.apple.com/verifyReceipt
        → 解析 JSON：status / receipt / in_app[].product_id
        → product_id 命中本地已购 SKU
        → setHasBuyFlowDataShow:YES
        → 写入 App Group(group.net) UserDefaults
        → checkUnlockStatus 读该键 → removeUnlockOverlay（解锁）
```

所以**不需要假的服务器、不需要改包，只要 MITM 掉 `verifyReceipt` 并返回「已购买」就能解锁**。
唯一不确定的是 `product_id` 的字面值——它是服务端下发/收据里带的，包里没有硬编码，脚本用候选集合兜底。

---

## 二、关键地址（arm64，基址 0x100000000）

| 地址 | 符号/方法 | 作用 |
|---|---|---|
| `0x100019380` | `verifyPurchaseWithPaymentTransaction` | 起头：读收据缓存 |
| `0x100019580` | 同上 | `appStoreReceiptURL` → base64(0x20) |
| `0x1000195c4` | 同上 | `stringWithFormat:@"{\"receipt-data\" : \"%@\"}"` |
| `0x100019600` | 同上 | `URLWithString:@"https://buy.itunes.apple.com/verifyReceipt"` |
| `0x100019630` | 同上 | `setHTTPMethod:@"POST"` |
| `0x1000196a4` | 同上 | `JSONObjectWithData:` 解析响应 |
| `0x1000196e4` | 同上 | `objectForKey:@"receipt"` ← 没有就失败 |
| `0x1000196fc` | 同上 | `objectForKey:@"in_app"` |
| `0x100019730` | 同上 | `objectForKey:@"product_id"` ← 逐个比对 |
| `0x1000197ac` | 同上 | 命中 → `setHasBuyFlowDataShow:` |
| `0x1000197d0` | 同上 | → `updateUIForPurchasedState` |
| `0x10005ce2c` | `verifySandBoxPurchaseWithPaymentTransaction` | 沙盒分支，逻辑同上，URL 为 `sandbox.itunes.apple.com` |
| `0x10005cdc8` | `checkUnlockStatus`（另一处） | 读已购状态，未购则弹提示 |
| `0x10006f3dc` | `checkUnlockStatus` | 读 `group.net` 的 `hasBuyFlowDataShow` |
| `0x10006f408` | 同上 | `[[NSUserDefaults alloc] initWithSuiteName:@"group.net"]` → `boolForKey:` |
| `0x10006f41c` | 同上 | 真 → `removeUnlockOverlay` |
| `0x10006f428` | 同上 | 假 → `showUnlockOverlay` |
| `0x100067eec` | 卡片内解锁按钮 | `unlock` → 购买流程 |
| `0x10006f914` | 解锁浮层按钮 | `unlockButtonTapped` |
| `0x10001991c` | `paymentQueue:updatedTransactions:` | 交易状态 == `SKPaymentTransactionStatePurchased` → 走校验 |

跳板表（`__TEXT,__objc_stubs`）对应关系：`0x1000ea2c0`=checkUnlockStatus、`0x1000ec40`=hasBuyFlowDataShow、
`0x1000eff60`=removeUnlockOverlay、`0x1000f5b00`=showUnlockOverlay、`0x1000f7b40`=verifyPurchaseWithPaymentTransaction。

---

## 三、关键字符串（`__TEXT,__cstring` / `__DATA,__cfstring`，明文）

```
{"receipt-data" : "%@"}
https://buy.itunes.apple.com/verifyReceipt
https://sandbox.itunes.apple.com/verifyReceipt
status / receipt / in_app / product_id
hasBuyFlowDataShow        ← 解锁开关
group.net                 ← App Group SuiteName（UserDefaults 容器）
unlockOverlayView / unlockButtonTapped / removeUnlockOverlay
ProUnlockViewController / FreeGetVipViewController
isLifetimePro / userLevel / isBlockUser   ← Net.dylib 内 hook 的方法名
```

`Net.dylib` 里还发现 `MSHookMessageEx`（Cydia Substrate 钩子），说明发行方内置了营销/风控注入；
同目录还有一个重打包者附加的 `Frameworks/Tg:@HelloWorld_1024.dylib`（`zxPluginsInject`，专门 hook
`NSUserDefaults initWithSuiteName` 把容器路径重定向到 App Group），与破解逻辑无关。

---

## 四、其他可用弱点（供参考）

1. **本地状态存储就是全部**：`hasBuyFlowDataShow` 存在 `group.net` 的 UserDefaults 里，
   键名是明文。任何能写该键的手段（LLDB / 越狱 tweak / 备份恢复）都能直接解锁，不需要网络。
2. **`isLifetimePro` / `userLevel`**：这两个 selector 会被 `Net.dylib` hook，
   说明 App 内部的 VIP 判断也走这两个方法，可作为越狱端 hook 的备用目标。
3. **调试残留**：二进制里有 `Test DeviceId : %@`、`FlowDataTestViewController`，发行版未剔除。
4. **无自定义 API**：整个包里除了 Apple/百度统计/ipify 外没有任何业务域名，所以 Loon 只需拦 Apple 两个域名。

---

## 五、交付物

| 文件 | 说明 |
|---|---|
| `Net-Pro.plugin` | Loon 插件（Rewrite + MITM，4 条 http-response） |
| `haiou-verifyreceipt.js` | 旧版 verifyReceipt 重写脚本（已验证 4 个用例） |
| `haiou-jws.js` | 新版 JWS 收据重写脚本（前瞻，Apple 已迁移） |
| `test-verifyreceipt.js` | 本地 Node 测试桩 |

### 用法
1. 把两个 `.js` 传到能公网访问的地方（GitHub raw / Gist / 自己的服务器）。
2. 把 `Net-Pro.plugin` 里 `https://raw.githubusercontent.com/<你的GitHub用户名>/<仓库名>/main/` 替换成真实地址。
3. Loon → 配置 → 插件 → 添加该 plugin 链接；确认 MITM 主机名包含
   `buy.itunes.apple.com, sandbox.itunes.apple.com`，并安装/信任 Loon 证书。
4. 杀掉海鸥重开，点解锁。

### 本机已通过的测试
```
[实机桩] status=200 ctype=application/json keep=1 | bodyStatus=0 env=Production in_app=15
[用例2] env=Sandbox pid=com.lfb.netlight.vip.lifetime
[用例3] 坏JSON兜底 status=200 in_app=15
[用例4] 幂等=true
JWS: txs=7, 解码 payload → productId=com.lfb.netlight.vip.lifetime, type=Non-Consumable, bundle=lfb.com.Netlight
```

---

## 六、风险与限制

- **product_id 未知**：包里没有硬编码 SKU，脚本给了 15 个候选。若解锁不生效，
  用 Loon 的请求日志抓一次真实的购买（或看 App 内购页返回），把真实 pid 加到 `SKU_HINTS` 首位。
- **若 App 未来改成本地 JWS 验签**（`clientVerification`），`haiou-jws.js` 会失效，需要动态派生 Apple 根证书签名——目前 3.1 没有。
- 收据校验只看 `in_app[].product_id`，不校验 `bundle_id`/`signature` 之外的字段，所以伪造难度极低。
