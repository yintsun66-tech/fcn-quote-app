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

function scenarioAssessment(terms, indexPct) {
  const koBarrierPct = finiteNumber(terms.koBarrierPct);
  const strikePct = finiteNumber(terms.strikePct);
  const kiBarrierPct = finiteNumber(terms.kiBarrierPct);
  const barrierType = String(terms.barrierType ?? "NONE").toUpperCase();
  const koReached = koBarrierPct !== null && indexPct >= koBarrierPct;

  if (koReached) {
    return {
      koAssessment: "達到試算 KO 水準",
      kiAssessment: barrierType === "NONE" ? "不適用（無 KI）" : "KO 後不再延伸到期情境",
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

  return { koAssessment: koBarrierPct === null ? "缺少 KO Barrier" : "未達試算 KO 水準", kiAssessment, outcome };
}

export function buildFcnAnalysis(terms, indicativeSpots = {}, scenarioChanges = ANALYSIS_SCENARIOS) {
  if (String(terms?.product ?? "").toUpperCase() !== "FCN") {
    throw new Error("Phase 1 僅支援 FCN 商品。");
  }

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
    const assessment = scenarioAssessment(terms, indexPct);
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
    disclaimer: "本頁以使用者輸入的參考現價做比例試算，不是即時行情、正式評價、投資建議或最終契約現金流。多標的採最弱標的（Worst-of）觀察，不取平均。"
  };
}
