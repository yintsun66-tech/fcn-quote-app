export const ANALYSIS_SCENARIOS = Object.freeze([-50, -40, -30, -20, -10, 0, 10, 20]);

function finiteNumber(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseIndicativeSpot(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

export function spotStorageKey(rfqId, tradeCode, underlying) {
  return [
    "fcn-market-analysis",
    "v1",
    encodeURIComponent(String(rfqId ?? "")),
    encodeURIComponent(String(tradeCode ?? "")),
    encodeURIComponent(String(underlying ?? "").trim().toUpperCase())
  ].join(":");
}

function priceAtPercentage(spot, percentage) {
  return spot === null || percentage === null ? null : spot * percentage / 100;
}

function analysisProduct(value) {
  const normalized = String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toUpperCase();
  if (normalized === "FCN") return "FCN";
  if (["DAC", "DRA", "WRA", "RANGE ACCRUAL"].includes(normalized)) return "DAC";
  return null;
}

function dacAccrualAssessment(product, strikePct, indexPct) {
  if (product !== "DAC") return null;
  if (strikePct === null) return "缺少執行價，無法判斷保息期間結束後的利息條件。";
  return indexPct > strikePct
    ? "保息期間結束後：本情境下所有連結標的均高於執行價，才符合該期利息條件。"
    : "保息期間結束後：最弱標的未高於執行價，該期不符合利息條件。";
}

function scenarioAssessment(terms, indexPct, product) {
  const koBarrierPct = finiteNumber(terms.koBarrierPct);
  const strikePct = finiteNumber(terms.strikePct);
  const kiBarrierPct = finiteNumber(terms.kiBarrierPct);
  const barrierType = String(terms.barrierType ?? "NONE").toUpperCase();
  const koReached = koBarrierPct !== null && indexPct >= koBarrierPct;
  const accrualAssessment = dacAccrualAssessment(product, strikePct, indexPct);

  if (koReached) {
    return {
      koAssessment: "達到試算 KO 水準",
      kiAssessment: barrierType === "NONE" ? "不適用（無 KI）" : "KO 後不再延伸到期情境",
      accrualAssessment,
      outcome: "可能提前出場；實際結果仍取決於觀察日、記憶條款與正式文件。"
    };
  }

  let kiAssessment = "不適用（無 KI）";
  let outcome = indexPct < (strikePct ?? 0)
    ? "未達 KO 且低於試算執行價；到期償付請依正式條款判斷。"
    : "未達 KO；此情境仍須持有至後續觀察或到期。";

  if (barrierType === "EKI") {
    const kiReached = kiBarrierPct !== null && indexPct <= kiBarrierPct;
    kiAssessment = kiBarrierPct === null
      ? "缺少 KI Barrier"
      : kiReached
        ? "到期位於或低於試算 KI 水準"
        : "到期高於試算 KI 水準";
    if (kiReached && strikePct !== null && indexPct < strikePct) {
      outcome = "到期可能承擔最弱標的下跌風險；實際償付以正式條款為準。";
    }
  } else if (barrierType === "AKI") {
    kiAssessment = "需分「期間未觸及／曾觸及」兩條路徑";
    outcome = "僅憑到期價格無法判定 AKI；請搭配下方兩條路徑閱讀。";
  }

  return {
    koAssessment: koBarrierPct === null ? "缺少 KO Barrier" : "未達試算 KO 水準",
    kiAssessment,
    accrualAssessment,
    outcome
  };
}

export function buildFcnAnalysis(terms, indicativeSpots = {}, scenarioChanges = ANALYSIS_SCENARIOS) {
  const product = analysisProduct(terms?.product);
  if (!product) throw new Error("市場與風險分析僅支援 FCN、DAC／DRA 商品。");

  const underlyings = Array.isArray(terms.underlyings)
    ? terms.underlyings.filter(item => typeof item === "string" && item.trim()).map(item => item.trim())
    : [];
  if (!underlyings.length) throw new Error("缺少連結標的，無法進行情境分析。");

  const strikePct = finiteNumber(terms.strikePct);
  const koBarrierPct = finiteNumber(terms.koBarrierPct);
  const kiBarrierPct = finiteNumber(terms.kiBarrierPct);
  const barrierType = String(terms.barrierType ?? "NONE").toUpperCase();

  const referenceLevels = underlyings.map(underlying => {
    const spot = parseIndicativeSpot(indicativeSpots[underlying]);
    return {
      underlying,
      spot,
      strikePrice: priceAtPercentage(spot, strikePct),
      koPrice: priceAtPercentage(spot, koBarrierPct),
      kiPrice: barrierType === "NONE" ? null : priceAtPercentage(spot, kiBarrierPct)
    };
  });

  const scenarios = scenarioChanges.map(changeValue => {
    const changePct = finiteNumber(changeValue);
    if (changePct === null) throw new Error("情境變動必須是有限數字。");
    const indexPct = 100 + changePct;
    const assessment = scenarioAssessment(terms, indexPct, product);
    return {
      changePct,
      worstOfReturnPct: changePct,
      worstOfIndexPct: indexPct,
      projectedPrices: referenceLevels.map(level => ({
        underlying: level.underlying,
        price: level.spot === null ? null : level.spot * indexPct / 100
      })),
      ...assessment
    };
  });

  return {
    product,
    referenceLevels,
    metrics: {
      koRequiredMovePct: koBarrierPct === null ? null : koBarrierPct - 100,
      kiBufferPct: barrierType === "NONE" || kiBarrierPct === null ? null : 100 - kiBarrierPct
    },
    scenarios,
    akiBranches: barrierType === "AKI"
      ? [
        {
          key: "NO_TOUCH",
          title: "路徑一：存續期間未曾觸及 KI",
          description: "即使到期價格偏低，仍須依正式條款確認本金與收益結果；本頁不自行推定現金流。"
        },
        {
          key: "TOUCHED",
          title: "路徑二：存續期間曾觸及 KI",
          description: "若到期最弱標的亦低於執行價，可能承擔下跌風險；實際償付以正式條款為準。"
        }
      ]
      : [],
    dacAccrualCondition: product === "DAC"
      ? {
        guaranteedPeriodsMonths: finiteNumber(terms.guaranteedPeriodsMonths),
        strikePct,
        rule: "ALL_UNDERLYINGS_ABOVE_STRIKE",
        description: "保息期間結束後，所有連結標的必須全部大於執行價，才會有利息；任一標的未大於執行價，該期即不符合利息條件。"
      }
      : null,
    disclaimer: "本頁以使用者輸入的參考現價做比例試算，不是即時行情、正式評價、投資建議或最終契約現金流。多標的採最弱標的（Worst-of）觀察，不取平均。"
  };
}
