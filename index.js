const axios = require('axios');
const ethers = require('ethers');
const dotenv = require('dotenv');
const readline = require('readline');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');

dotenv.config();

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bold: "\x1b[1m",
  blue: "\x1b[34m"
};

const logger = {
  info: (msg) => console.log(`${colors.green}[✓] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[⚠] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
  random: (msg) => console.log(`${colors.cyan}[🎲] ${msg}${colors.reset}`),
  proxy: (msg) => console.log(`${colors.blue}[🔌] ${msg}${colors.reset}`),
  retry: (msg) => console.log(`${colors.yellow}[🔄] ${msg}${colors.reset}`),
  debug: (msg) => console.log(`${colors.white}[🔧] ${msg}${colors.reset}`), 
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log(`---------------------------------------------`);
    console.log(`            Faroswap_Atlantic Swap Bot       `);
    console.log(`                                             `);
    console.log(`---------------------------------------------${colors.reset}`);
    console.log();
  }
};

const TOKENS = {
  PHRS: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  USDT: '0xE7E84B8B4f39C507499c40B4ac199B050e2882d5'
};

const PHAROS_CHAIN_ID = 688689;
const PHAROS_RPC_URLS = ['https://atlantic.dplabs-internal.com'];
const DODO_ROUTER = '0x819829e5cf6e19f9fed92f6b4cc1edf45a2cc4a2';


// ⭐️ HÀM ĐÃ CHỈNH SỬA
function getRandomSwapAmount() {
    let randomSuffix = '';
    
    // Tạo 4 chữ số ngẫu nhiên, mỗi chữ số từ 1 đến 9
    for (let i = 0; i < 4; i++) {
        // Math.floor(Math.random() * 9) + 1 tạo số nguyên từ 1 đến 9
        randomSuffix += (Math.floor(Math.random() * 9) + 1).toString();
    }
    
    // Ghép chuỗi '0.0001' với 4 chữ số ngẫu nhiên để tạo định dạng 0.0001xxxx
    const amountString = '0.0001' + randomSuffix;
    
    // Chuyển lại thành số (Floating Point Number)
    return parseFloat(amountString);
}

// ⬇️ HÀM MỚI: Tạo độ trễ ngẫu nhiên từ 30000ms (30s) đến 60000ms (60s)
function getRandomDelay() {
  const minMs = 30000; // 30 giây
  const maxMs = 60000; // 60 giây
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}


let proxyList = [];
try {
  proxyList = fs.readFileSync('proxy.txt', 'utf8')
    .split('\n')
    .map(p => p.trim())
    .filter(p => p.length > 0);
  
  logger.info(`Loaded ${proxyList.length} proxies from proxy.txt`);
} catch (error) {
  logger.warn("proxy.txt not found, running without proxies");
  proxyList = [];
}

let proxyIndex = 0;
function getNextProxy() {
  if (proxyList.length === 0) return null;
  const proxy = proxyList[proxyIndex % proxyList.length];
  proxyIndex++;
  return proxy;
}

function getProviderWithProxy(proxyStr) {
  if (!proxyStr) {
    return new ethers.JsonRpcProvider(
      PHAROS_RPC_URLS[0],
      {
        chainId: PHAROS_CHAIN_ID,
        name: 'pharos'
      }
    );
  }

  try {
    let proxyUrl;
    if (proxyStr.includes('@')) {
      
      proxyUrl = `http://${proxyStr}`;
    } else {
      
      proxyUrl = `http://${proxyStr}`;
    }

    logger.proxy(`Using proxy: ${proxyStr}`);
    const agent = new HttpsProxyAgent(proxyUrl);

    return new ethers.JsonRpcProvider(
      PHAROS_RPC_URLS[0],
      {
        chainId: PHAROS_CHAIN_ID,
        name: 'pharos',
        fetchOptions: { agent }
      }
    );
  } catch (error) {
    logger.error(`Proxy error: ${error.message}`);
    
    return new ethers.JsonRpcProvider(
      PHAROS_RPC_URLS[0],
      {
        chainId: PHAROS_CHAIN_ID,
        name: 'pharos'
      }
    );
  }
}

function loadPrivateKeys() {
  const keys = [];
  let i = 1;
  while (process.env[`PRIVATE_KEY_${i}`]) {
    const pk = process.env[`PRIVATE_KEY_${i}`];
    if (pk.startsWith('0x') && pk.length === 66) keys.push(pk);
    i++;
  }
  return keys;
}

async function fetchWithTimeout(url, timeout = 15000) {
  const source = axios.CancelToken.source();
  const timer = setTimeout(() => source.cancel('Timeout'), timeout);

  try {
    const res = await axios.get(url, { cancelToken: source.token });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw new Error('Timeout or network error');
  }
}


async function robustFetchDodoRoute(url) {
  let attempt = 1;

  while (true) {
    try {
      const res = await fetchWithTimeout(url);
      const data = res.data;

      if (data.status !== -1) {
        logger.success(`DODO API OK after ${attempt} attempts`);
        return data;
      }

      logger.warn(`DODO status -1 (attempt ${attempt})`);

    } catch (e) {
      logger.warn(`DODO API error (attempt ${attempt}): ${e.message}`);
    }

    attempt++;
    // Độ trễ 2 giây khi gặp lỗi DODO API vẫn giữ nguyên
    await new Promise(r => setTimeout(r, 2000)); 
  }
}

async function fetchDodoRoute(fromAddr, toAddr, userAddr, amountWei) {
  const deadline = Math.floor(Date.now() / 1000) + 600;

  const url = `https://api.dodoex.io/route-service/v2/widget/getdodoroute?chainId=${PHAROS_CHAIN_ID}&deadLine=${deadline}&apikey=a37546505892e1a952&slippage=3.225&source=dodoV2AndMixWasm&toTokenAddress=${toAddr}&fromTokenAddress=${fromAddr}&userAddr=${userAddr}&estimateGas=true&fromAmount=${amountWei}`;

  const result = await robustFetchDodoRoute(url);

  if (!result.data || !result.data.data) {
    throw new Error("Invalid DODO API response");
  }

  return result.data;
}


async function executeSwap(wallet, routeData, fromAddr, amount, retryCount = 0) {
  try {
    const nonce = await wallet.getNonce("pending");

    const tx = await wallet.sendTransaction({
      to: routeData.to,
      data: routeData.data,
      value: BigInt(routeData.value),
      gasLimit: BigInt(routeData.gasLimit || 500000),
      nonce
    });

    logger.success(`Swap TX sent: ${tx.hash}`);
    const receipt = await tx.wait();
    logger.success(`Swap Confirmed! View transaction: https://atlantic.pharosscan.xyz/tx/${tx.hash}`);

    return receipt;

  } catch (e) {
    logger.error(`Swap failed: ${e.message}`);

    
    if (proxyList.length > 0 && retryCount < 5) {
      const newProxy = getNextProxy();
      logger.warn(`Rotating proxy and retrying swap ${retryCount + 1}/10`);
      wallet.provider = getProviderWithProxy(newProxy);
      // Độ trễ 2 giây khi đổi proxy vẫn giữ nguyên
      await new Promise(r => setTimeout(r, 2000));
      return executeSwap(wallet, routeData, fromAddr, amount, retryCount + 1);
    }

    if (retryCount < 10) { 
      logger.retry(`Retrying swap ${retryCount + 1}/10`);
      // Độ trễ 2 giây khi thử lại vẫn giữ nguyên
      await new Promise(r => setTimeout(r, 2000));
      return executeSwap(wallet, routeData, fromAddr, amount, retryCount + 1);
    }

    throw e;
  }
}


async function batchSwap(wallet, count) {
  let successfulSwaps = 0;
  
  for (let i = 0; i < count; i++) {
    let swapSuccess = false;
    let swapAttempt = 0;
    const maxSwapAttempts = 3; 
    
    while (!swapSuccess && swapAttempt < maxSwapAttempts) {
      
      const randomAmount = getRandomSwapAmount();
      const randomAmountWei = ethers.parseEther(randomAmount.toString());
      
      if (swapAttempt > 0) {
        logger.retry(`Retry attempt ${swapAttempt + 1} for swap #${i + 1}`);
      }
      
      logger.random(`Random swap amount: ${randomAmount} PHRS`);
      logger.step(`Swap #${i + 1} of ${count}: PHRS -> USDT for wallet ${wallet.address}`);

      try {
        
        const data = await fetchDodoRoute(TOKENS.PHRS, TOKENS.USDT, wallet.address, randomAmountWei);
        await executeSwap(wallet, data, TOKENS.PHRS, randomAmountWei);
        successfulSwaps++;
        swapSuccess = true;
        logger.success(`Successfully completed swap ${successfulSwaps}/${count}`);

      } catch (e) {
        swapAttempt++;
        logger.error(`Swap ${i + 1} attempt ${swapAttempt} failed: ${e.message}`);
        
        if (swapAttempt < maxSwapAttempts) {
          // Độ trễ 3 giây khi cố gắng thử lại sau khi thất bại vẫn giữ nguyên
          logger.retry(`Fetching fresh API data and retrying in 3 seconds...`);
          await new Promise(r => setTimeout(r, 3000));
        } else {
          logger.error(`Max attempts reached for swap ${i + 1}, moving to next swap`);
        }
      }
    }

    
    if (i < count - 1) {
      // ⬇️ THAY ĐỔI: Độ trễ ngẫu nhiên giữa các lần swap của cùng một ví
      const waitTime = getRandomDelay();
      logger.debug(`Waiting ${waitTime/1000} seconds before next swap...`);
      await new Promise(r => setTimeout(r, waitTime));
    }
  }
  
  return successfulSwaps;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));

(async () => {
  logger.banner();

  const privateKeys = loadPrivateKeys();
  if (privateKeys.length === 0) {
    logger.error("No private keys found in .env");
    process.exit(1);
  }

  logger.info(`Loaded ${privateKeys.length} wallet(s) and ${proxyList.length} proxy/proxies`);

  const countNum = parseInt(await ask(`${colors.cyan}How many PHRS → USDT swaps per wallet? ${colors.reset}`));
  if (!countNum || countNum < 1) {
    logger.error("Invalid number");
    process.exit(1);
  }

  let totalSuccessfulSwaps = 0;
  let totalAttemptedSwaps = 0;

  logger.success(`Starting single cycle for all wallets...`);

  for (const [i, pk] of privateKeys.entries()) {
    const proxy = getNextProxy();
    const provider = getProviderWithProxy(proxy);
    const wallet = new ethers.Wallet(pk, provider);
    
    logger.success(`\nProcessing Wallet ${i + 1}/${privateKeys.length}: ${wallet.address}`);
    if (proxy) {
      logger.proxy(`Using proxy for this wallet`);
    }

    const successful = await batchSwap(wallet, countNum);
    totalSuccessfulSwaps += successful;
    totalAttemptedSwaps += countNum;
    
    logger.success(`Wallet ${wallet.address} completed: ${successful}/${countNum} swaps`);
    
    
    if (i < privateKeys.length - 1) {
      // ⬇️ THAY ĐỔI: Độ trễ ngẫu nhiên giữa các ví
      const waitTime = getRandomDelay();
      logger.info(`Waiting ${waitTime/1000} seconds before next wallet...`);
      await new Promise(r => setTimeout(r, waitTime));
    }
  }

  
  logger.success(`\n🎉 ALL WALLETS COMPLETED!`);
  logger.success(`================================`);
  logger.success(`Total Wallets: ${privateKeys.length}`);
  logger.success(`Swaps per Wallet: ${countNum}`);
  logger.success(`Total Attempted Swaps: ${totalAttemptedSwaps}`);
  logger.success(`Total Successful Swaps: ${totalSuccessfulSwaps}`);
  if (totalAttemptedSwaps > 0) {
    logger.success(`Success Rate: ${((totalSuccessfulSwaps / totalAttemptedSwaps) * 100).toFixed(2)}%`);
  } else {
    logger.success(`Success Rate: 0.00%`);
  }
  logger.success(`================================`);
  
  logger.info(`Bot has finished all tasks. Exiting...`);
  process.exit(0);
})();
