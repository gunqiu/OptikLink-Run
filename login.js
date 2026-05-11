const { chromium } = require('playwright');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

(async () => {
  // 启动浏览器（无头模式）
  const browser = await chromium.launch();

  const context = await browser.newContext({
    extraHTTPHeaders: {
      Cookie: process.env.USER_COOKIE || '', // 防止环境变量为空时报错
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  });

  const page = await context.newPage();
  let report = "⚠️ 未知状态";

  try {
    console.log("正在访问控制面板...");
    await page.goto("https://control.optiklink.net/", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    // 查找服务器链接
    const href = await page.getAttribute('a[href*="/server/"]', 'href');
    if (!href) throw new Error("无法在页面找到服务器列表链接");

    console.log(`发现服务器详情页: ${href}`);
    await page.goto("https://control.optiklink.net" + href);
    
    // 等待页面加载状态（根据控制台输出调整时间）
    await page.waitForTimeout(10000);

    const html = (await page.content()).toLowerCase();

    // 逻辑判定：如果是离线则尝试启动
    if (html.includes("offline")) {
      await page.evaluate(() => {
        const buttons = [...document.querySelectorAll("button")];
        const startBtn = buttons.find(b => b.innerText.toUpperCase().includes("START"));
        if (startBtn) startBtn.click();
      });
      report = "OFFLINE ✅ 检测到离线并已尝试启动";
    } else if (html.includes("running") || html.includes("online")) {
      report = "✅ 运行中 (RUNNING)";
    } else {
      report = "❓ 状态不明，请检查截图";
    }

    await page.screenshot({ path: "final.png" });
    await send("final.png", report);

  } catch (e) {
    console.error(`运行出错: ${e.message}`);
    // 出错时尝试截取错误页面
    try {
      await page.screenshot({ path: "error.png" });
      await send("error.png", "❌ 运行异常: " + e.message);
    } catch (err) {
      console.error("无法保存错误截图");
    }
  } finally {
    await browser.close();
    console.log("浏览器已关闭，流程结束。");
  }
})();

/**
 * 核心发送逻辑：增加了对 TG 变量的静默处理
 */
async function send(file, msg) {
  // 始终在 GitHub Actions 日志中打印结果，方便直接查看
  console.log(`------------------------------`);
  console.log(`[当前状态] ${msg}`);
  console.log(`------------------------------`);

  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  // --- 关键改动：静默检查 ---
  // 如果没有配置 TG 变量，直接 return，不执行后续 axios 请求，因此不会报错
  if (!token || !chatId || token === "" || chatId === "") {
    console.log("[提示] 未检测到有效的 Telegram 配置，本次运行仅记录日志。");
    return;
  }

  // 只有当变量存在时，才尝试发送
  try {
    const f = new FormData();
    f.append("chat_id", chatId);
    f.append("caption", msg);
    if (fs.existsSync(file)) {
      f.append("photo", fs.createReadStream(file));
    } else {
      console.log("未找到截图文件，仅尝试发送文字。");
    }

    await axios.post(
      `https://api.telegram.org/bot${token}/sendPhoto`,
      f,
      { 
        headers: f.getHeaders(),
        timeout: 10000 // 增加超时控制，防止因 TG 网络问题卡住工作流
      }
    );
    console.log("[Telegram] 通知发送成功");
  } catch (err) {
    // 即使发送请求失败（如网络波动），也只打印错误，不 throw，保证工作流还是绿色的
    console.error("[Telegram] 发送过程中出现异常，但已忽略：", err.message);
  }
}
