"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

type PartnerId = "A" | "B";

type FinanceTxType =
  | "income" // ลูกค้าโอนเงิน (หาร 2)
  | "advance" // เบิกเงินไปใช้ก่อน
  | "settlement" // โอนเคลียร์ยอดระหว่างกัน
  | "expense"; // ค่าใช้จ่ายส่วนกลาง (หาร 2)

interface FinanceTransaction {
  id: string;
  type: FinanceTxType;
  amount: number;
  partner: PartnerId;
  advance_source?: "self_held" | "other_partner_transfer";
  note: string;
  customer_name?: string;
  created_at: number;
}

interface FinanceSettings {
  partner_a_name: string;
  partner_b_name: string;
}

interface FinanceApiResponse {
  ok: boolean;
  storage_mode?: string;
  state?: {
    settings: FinanceSettings;
    transactions: FinanceTransaction[];
    deleted_ids: string[];
    updated_at: number;
  };
}

// ============================================================================
// FORMATTING HELPERS
// ============================================================================

function formatMoney(amount: number): string {
  const num = Number(amount || 0);
  return num.toLocaleString("th-TH", {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatThaiDateTime(epochSec: number): string {
  if (!epochSec) return "-";
  const d = new Date(epochSec * 1000);
  return d.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const LOCAL_STORAGE_TX_KEY = "nexus_finance_transactions_v1";
const LOCAL_STORAGE_SETTINGS_KEY = "nexus_finance_settings_v1";
const LOCAL_STORAGE_DELETED_KEY = "nexus_finance_deleted_ids_v1";

// ============================================================================
// MAIN FINANCE PAGE COMPONENT
// ============================================================================

export default function FinancePage() {
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [settings, setSettings] = useState<FinanceSettings>({
    partner_a_name: "เรา (ตัวเอง)",
    partner_b_name: "เพื่อน (หุ้นส่วน)",
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number>(Date.now());
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);

  // Settings Modal State
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [editNameA, setEditNameA] = useState<string>("เรา (ตัวเอง)");
  const [editNameB, setEditNameB] = useState<string>("เพื่อน (หุ้นส่วน)");

  // Form State
  const [txType, setTxType] = useState<FinanceTxType>("income");
  const [selectedPartner, setSelectedPartner] = useState<PartnerId>("B");
  const [advanceSource, setAdvanceSource] = useState<
    "self_held" | "other_partner_transfer"
  >("other_partner_transfer");
  const [amountInput, setAmountInput] = useState<string>("");
  const [customerInput, setCustomerInput] = useState<string>("");
  const [noteInput, setNoteInput] = useState<string>("");

  // Filter & Search State
  const [filterType, setFilterType] = useState<"ALL" | FinanceTxType>("ALL");
  const [filterPartner, setFilterPartner] = useState<"ALL" | PartnerId>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  // Save to localStorage helper
  const saveLocalBackup = useCallback(
    (
      txs: FinanceTransaction[],
      cfg?: FinanceSettings,
      deletedIds?: string[]
    ) => {
      try {
        localStorage.setItem(LOCAL_STORAGE_TX_KEY, JSON.stringify(txs));
        if (cfg) {
          localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, JSON.stringify(cfg));
        }
        if (deletedIds) {
          localStorage.setItem(
            LOCAL_STORAGE_DELETED_KEY,
            JSON.stringify(deletedIds)
          );
        }
      } catch {
        // ignore storage errors
      }
    },
    []
  );

  // Load & Sync Data
  const loadFinanceData = useCallback(
    async (isBackground = false) => {
      let localTxs: FinanceTransaction[] = [];
      let localSettings: FinanceSettings | null = null;
      let localDeleted: string[] = [];

      try {
        const rawTxs = localStorage.getItem(LOCAL_STORAGE_TX_KEY);
        if (rawTxs) localTxs = JSON.parse(rawTxs) || [];
        const rawCfg = localStorage.getItem(LOCAL_STORAGE_SETTINGS_KEY);
        if (rawCfg) localSettings = JSON.parse(rawCfg) || null;
        const rawDel = localStorage.getItem(LOCAL_STORAGE_DELETED_KEY);
        if (rawDel) localDeleted = JSON.parse(rawDel) || [];
      } catch {
        // ignore
      }

      if (!isBackground && localTxs.length > 0) {
        setTransactions(localTxs);
      }
      if (localSettings) {
        setSettings(localSettings);
        setEditNameA(localSettings.partner_a_name);
        setEditNameB(localSettings.partner_b_name);
      }

      try {
        const res = await fetch(`/api/finance?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as FinanceApiResponse;

        if (data.ok && data.state) {
          const srvTxs = data.state.transactions || [];
          const srvDeleted = new Set([...(data.state.deleted_ids || [])]);

          // Merge server + local transactions (Server transactions take priority!)
          const txMap = new Map<string, FinanceTransaction>();
          srvTxs.forEach((item) => {
            if (item && item.id && !srvDeleted.has(item.id)) {
              txMap.set(item.id, item);
            }
          });
          localTxs.forEach((item) => {
            if (
              item &&
              item.id &&
              !srvDeleted.has(item.id) &&
              !txMap.has(item.id)
            ) {
              txMap.set(item.id, item);
            }
          });

          const mergedTxs = Array.from(txMap.values()).sort(
            (a, b) => (b.created_at || 0) - (a.created_at || 0)
          );

          const mergedSettings =
            data.state.settings.partner_a_name !== "เรา (ตัวเอง)" ||
            data.state.settings.partner_b_name !== "เพื่อน (หุ้นส่วน)"
              ? data.state.settings
              : localSettings || data.state.settings;

          setTransactions(mergedTxs);
          setSettings(mergedSettings);
          setEditNameA(mergedSettings.partner_a_name);
          setEditNameB(mergedSettings.partner_b_name);
          setLastSyncedAt(Date.now());
          saveLocalBackup(
            mergedTxs,
            mergedSettings,
            Array.from(srvDeleted.values())
          );

          // If local had transactions that server lost (e.g. cold start), sync back to server
          if (mergedTxs.length > srvTxs.length) {
            await fetch("/api/finance", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "sync_client_state",
                transactions: mergedTxs,
                settings: mergedSettings,
              }),
            });
          }
        }
      } catch {
        // Fallback to local state silently
      } finally {
        setLoading(false);
      }
    },
    [saveLocalBackup]
  );

  useEffect(() => {
    loadFinanceData();
    const timer = setInterval(() => {
      loadFinanceData(true);
    }, 10000); // Auto-sync every 10 seconds!
    return () => clearInterval(timer);
  }, [loadFinanceData]);

  // Force re-sync directly from server (wipes local cache and reloads live data)
  const handleForceServerSync = async () => {
    setIsSyncing(true);
    try {
      localStorage.removeItem(LOCAL_STORAGE_TX_KEY);
      localStorage.removeItem(LOCAL_STORAGE_DELETED_KEY);
      const res = await fetch(`/api/finance?t=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (data.ok && data.state) {
        const srv = data.state.transactions || [];
        setTransactions(srv);
        setSettings(data.state.settings);
        setLastSyncedAt(Date.now());
        saveLocalBackup(srv, data.state.settings, []);
        showToast(`✅ ดึงข้อมูลสดจากเซิร์ฟเวอร์สำเร็จ (${srv.length} รายการ)!`);
      }
    } catch {
      showToast("❌ ซิงค์ไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setIsSyncing(false);
    }
  };

  // ============================================================================
  // CORE 50/50 ACCOUNTING ENGINE
  // ============================================================================
  const summary = useMemo(() => {
    let incomeA = 0;
    let incomeB = 0;
    let incomeCountA = 0;
    let incomeCountB = 0;

    let expensePaidByA = 0;
    let expensePaidByB = 0;

    // ยอดที่แต่ละคนเบิกไปใช้ส่วนตัวแล้ว (หักจากโควต้าส่วนแบ่ง 50%)
    let advanceUsedByA = 0;
    let advanceUsedByB = 0;

    // ยอดที่โอนข้ามบัญชีตอนเบิกเงินไปใช้ก่อน (กรณีอีกคนโอนให้เบิก)
    let advanceTransferAtoB = 0;
    let advanceTransferBtoA = 0;

    // ยอดโอนเคลียร์บัญชีระหว่างกันโดยตรง
    let settlementAtoB = 0;
    let settlementBtoA = 0;

    transactions.forEach((tx) => {
      const amt = Number(tx.amount) || 0;
      if (amt <= 0) return;

      if (tx.type === "income") {
        if (tx.partner === "A") {
          incomeA += amt;
          incomeCountA += 1;
        } else {
          incomeB += amt;
          incomeCountB += 1;
        }
      } else if (tx.type === "expense") {
        if (tx.partner === "A") {
          expensePaidByA += amt;
        } else {
          expensePaidByB += amt;
        }
      } else if (tx.type === "advance") {
        if (tx.partner === "A") {
          advanceUsedByA += amt;
          if (tx.advance_source === "other_partner_transfer") {
            // เพื่อน (B) โอนเงินให้ เรา (A) เบิกไปใช้ก่อน
            advanceTransferBtoA += amt;
          }
        } else {
          advanceUsedByB += amt;
          if (tx.advance_source === "other_partner_transfer") {
            // เรา (A) โอนเงินให้ เพื่อน (B) เบิกไปใช้ก่อน
            advanceTransferAtoB += amt;
          }
        }
      } else if (tx.type === "settlement") {
        if (tx.partner === "A") {
          // A โอนเคลียร์ให้ B
          settlementAtoB += amt;
        } else {
          // B โอนเคลียร์ให้ A
          settlementBtoA += amt;
        }
      }
    });

    const totalIncome = incomeA + incomeB;
    const totalExpense = expensePaidByA + expensePaidByB;
    const netProfitPool = totalIncome - totalExpense;

    // ส่วนแบ่ง 50% ที่แต่ละคนควรได้รับทั้งหมด
    const shareEach = netProfitPool / 2;

    // เงินกองกลางสุทธิที่ไหลเข้ามือแต่ละคน (รวมยอดที่รับจากลูกค้า หักค่าใช้จ่ายที่ออกให้ และรวม/หักยอดที่โอนหากันแล้ว)
    const netReceivedByA =
      incomeA -
      expensePaidByA -
      settlementAtoB +
      settlementBtoA -
      advanceTransferAtoB +
      advanceTransferBtoA;

    const netReceivedByB =
      incomeB -
      expensePaidByB -
      settlementBtoA +
      settlementAtoB -
      advanceTransferBtoA +
      advanceTransferAtoB;

    // เงินสดที่ยังเหลืออยู่ในบัญชีของแต่ละคน (หลังหักที่ดึงไปใช้ส่วนตัวแบบ self_held)
    const selfWithdrawnA = advanceUsedByA - advanceTransferBtoA;
    const selfWithdrawnB = advanceUsedByB - advanceTransferAtoB;
    const cashRemainingInAccountA = netReceivedByA - selfWithdrawnA;
    const cashRemainingInAccountB = netReceivedByB - selfWithdrawnB;

    // โควต้าส่วนแบ่ง 50% คงเหลือที่แต่ละคนยังเบิกไปใช้ได้อีก (สิทธิ์ 50% - ที่เบิกใช้ส่วนตัวไปแล้ว)
    const remainingQuotaA = shareEach - advanceUsedByA;
    const remainingQuotaB = shareEach - advanceUsedByB;

    // คำนวณว่าตอนนี้ "ใครต้องโอนเคลียร์ให้ใครเท่าไหร่" เพื่อให้ทั้งคู่ได้รับเงินเท่ากับส่วนแบ่ง 50% (shareEach)
    // ถ้า netReceivedByA > shareEach แปลว่า A ถือเงินกองกลางเกินส่วนแบ่งของตัวเอง -> A ต้องโอนส่วนเกินให้ B
    const diffA = Math.round((netReceivedByA - shareEach) * 100) / 100;

    let settlementDirection: "A_TO_B" | "B_TO_A" | "EVEN" = "EVEN";
    let settlementAmount = 0;

    if (diffA > 0.01) {
      settlementDirection = "A_TO_B";
      settlementAmount = diffA;
    } else if (diffA < -0.01) {
      settlementDirection = "B_TO_A";
      settlementAmount = Math.abs(diffA);
    }

    return {
      incomeA,
      incomeB,
      incomeCountA,
      incomeCountB,
      totalIncome,
      expensePaidByA,
      expensePaidByB,
      totalExpense,
      netProfitPool,
      shareEach,
      advanceUsedByA,
      advanceUsedByB,
      totalAdvance: advanceUsedByA + advanceUsedByB,
      advanceTransferAtoB,
      advanceTransferBtoA,
      settlementAtoB,
      settlementBtoA,
      netReceivedByA,
      netReceivedByB,
      cashRemainingInAccountA,
      cashRemainingInAccountB,
      remainingQuotaA,
      remainingQuotaB,
      settlementDirection,
      settlementAmount,
    };
  }, [transactions]);

  // Filtered Transactions
  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (filterType !== "ALL" && tx.type !== filterType) return false;
      if (filterPartner !== "ALL" && tx.partner !== filterPartner) return false;
      if (!q) return true;
      return (
        tx.note?.toLowerCase().includes(q) ||
        tx.customer_name?.toLowerCase().includes(q) ||
        String(tx.amount).includes(q)
      );
    });
  }, [transactions, filterType, filterPartner, searchQuery]);

  // ============================================================================
  // ACTION HANDLERS
  // ============================================================================

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amountInput);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      showToast("⚠️ กรุณากรอกจำนวนเงินที่มากกว่า 0 บาท");
      return;
    }

    setSubmitting(true);
    const newTx: FinanceTransaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: txType,
      amount: Math.round(parsedAmount * 100) / 100,
      partner: selectedPartner,
      advance_source: txType === "advance" ? advanceSource : "self_held",
      customer_name: customerInput.trim(),
      note:
        noteInput.trim() ||
        (txType === "income"
          ? "ลูกค้าโอนค่าฟาร์ม"
          : txType === "advance"
          ? "เบิกเงินไปใช้ก่อน"
          : txType === "settlement"
          ? "โอนเคลียร์ยอดหาร 2"
          : "ค่าใช้จ่ายส่วนกลาง"),
      created_at: Math.floor(Date.now() / 1000),
    };

    const nextTxs = [newTx, ...transactions];
    setTransactions(nextTxs);
    saveLocalBackup(nextTxs);

    setAmountInput("");
    setCustomerInput("");
    setNoteInput("");

    try {
      await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_transaction",
          transaction: newTx,
        }),
      });
    } catch {
      // Saved in localStorage already
    } finally {
      setSubmitting(false);
      showToast("✅ บันทึกรายการเรียบร้อยแล้ว");
    }
  };

  // One-Click Quick Settle
  const handleQuickSettle = async () => {
    if (
      summary.settlementDirection === "EVEN" ||
      summary.settlementAmount <= 0
    ) {
      return;
    }

    const payer: PartnerId =
      summary.settlementDirection === "A_TO_B" ? "A" : "B";
    const payerName =
      payer === "A" ? settings.partner_a_name : settings.partner_b_name;
    const receiverName =
      payer === "A" ? settings.partner_b_name : settings.partner_a_name;

    const settleTx: FinanceTransaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: "settlement",
      amount: summary.settlementAmount,
      partner: payer,
      note: `${payerName} โอนเคลียร์ยอดให้ ${receiverName} ลงตัว`,
      created_at: Math.floor(Date.now() / 1000),
    };

    const nextTxs = [settleTx, ...transactions];
    setTransactions(nextTxs);
    saveLocalBackup(nextTxs);

    try {
      await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_transaction",
          transaction: settleTx,
        }),
      });
    } catch {
      // ignore
    }

    showToast(
      `✅ บันทึกโอนเคลียร์ยอด ฿${formatMoney(summary.settlementAmount)} เรียบร้อย!`
    );
  };

  const handleDeleteTransaction = async (id: string) => {
    const nextTxs = transactions.filter((t) => t.id !== id);
    setTransactions(nextTxs);

    try {
      const rawDel = localStorage.getItem(LOCAL_STORAGE_DELETED_KEY);
      const delList: string[] = rawDel ? JSON.parse(rawDel) : [];
      if (!delList.includes(id)) delList.push(id);
      saveLocalBackup(nextTxs, undefined, delList);

      await fetch(`/api/finance?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {
      // ignore
    }
    showToast("🗑️ ลบรายการแล้ว");
  };

  const handleClearAllTransactions = async () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "ต้องการล้างประวัติการเงินทั้งหมดเพื่อเริ่มรอบบัญชีใหม่ใช่หรือไม่?"
      )
    ) {
      return;
    }

    const allIds = transactions.map((t) => t.id);
    setTransactions([]);
    saveLocalBackup([], undefined, allIds);

    try {
      await fetch("/api/finance?mode=all", { method: "DELETE" });
    } catch {
      // ignore
    }
    showToast("🗑️ ล้างประวัติเริ่มรอบบัญชีใหม่เรียบร้อย");
  };

  const handleSavePartnerNames = async (e: React.FormEvent) => {
    e.preventDefault();
    const newSettings: FinanceSettings = {
      partner_a_name: editNameA.trim() || "เรา (ตัวเอง)",
      partner_b_name: editNameB.trim() || "เพื่อน (หุ้นส่วน)",
    };
    setSettings(newSettings);
    saveLocalBackup(transactions, newSettings);
    setShowSettingsModal(false);

    try {
      await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_settings",
          settings: newSettings,
        }),
      });
    } catch {
      // ignore
    }
    showToast("✅ บันทึกชื่อหุ้นส่วนเรียบร้อย");
  };

  const handleCopySummaryReport = () => {
    const settlementText =
      summary.settlementDirection === "A_TO_B"
        ? `👉 ${settings.partner_a_name} ต้องโอนให้ ${settings.partner_b_name}: ${formatMoney(
            summary.settlementAmount
          )} บาท`
        : summary.settlementDirection === "B_TO_A"
        ? `👉 ${settings.partner_b_name} ต้องโอนให้ ${settings.partner_a_name}: ${formatMoney(
            summary.settlementAmount
          )} บาท`
        : `✅ เคลียร์ยอดลงตัวแล้ว (0 บาท)`;

    const lines = [
      `📊 สรุปบัญชีฟาร์ม (หาร 2)`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `💰 รายรับลูกค้าทั้งหมด: ${formatMoney(summary.totalIncome)} ฿`,
      summary.totalExpense > 0
        ? `🛠️ หักค่าใช้จ่ายส่วนกลาง: -${formatMoney(summary.totalExpense)} ฿`
        : null,
      `✨ กำไรสุทธิหาร 2: คนละ ${formatMoney(summary.shareEach)} ฿`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `👤 [${settings.partner_a_name}]`,
      `• ลูกค้าโอนเข้าบัญชี: ${formatMoney(summary.incomeA)} ฿ (${summary.incomeCountA} งาน)`,
      `• เบิกไปใช้ส่วนตัวแล้ว: ${formatMoney(summary.advanceUsedByA)} ฿`,
      `• สิทธิ์ส่วนแบ่งคงเหลือ: ${formatMoney(summary.remainingQuotaA)} ฿`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `👤 [${settings.partner_b_name}]`,
      `• ลูกค้าโอนเข้าบัญชี: ${formatMoney(summary.incomeB)} ฿ (${summary.incomeCountB} งาน)`,
      `• เบิกไปใช้ส่วนตัวแล้ว: ${formatMoney(summary.advanceUsedByB)} ฿`,
      `• สิทธิ์ส่วนแบ่งคงเหลือ: ${formatMoney(summary.remainingQuotaB)} ฿`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `⚖️ สรุปเคลียร์ยอดโอนหากัน:`,
      settlementText,
    ]
      .filter(Boolean)
      .join("\n");

    navigator.clipboard.writeText(lines);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2500);
    showToast("📋 คัดลอกสรุปบัญชีสำหรับส่งในแชทแล้ว!");
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Subtle Clean Ambient Top Light */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-gradient-to-b from-emerald-500/[0.06] via-sky-500/[0.03] to-transparent" />

      {/* Floating Toast */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 rounded-2xl border border-emerald-400/40 bg-slate-900/95 px-4 py-3 text-sm font-semibold text-emerald-200 shadow-2xl backdrop-blur-xl">
          {toastMsg}
        </div>
      )}

      <main className="relative z-10 mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* ===================================================================
            TOP NAVIGATION & HEADER
        =================================================================== */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-white/10 bg-slate-900/75 p-5 backdrop-blur-xl">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition"
              >
                <span>←</span>
                <span>กลับหน้ามอนิเตอร์บอท</span>
              </Link>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
                💰 ระบบบัญชีหุ้นส่วน 50 / 50
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white pt-1">
              จัดการการเงิน & หารค่าฟาร์ม (Split 50/50)
            </h1>
            <p className="text-xs sm:text-sm text-slate-400">
              รวมยอดโอนจากลูกค้าคนละบัญชี คำนวณส่วนแบ่งคนละครึ่ง และเช็กยอดเบิกเงินไปใช้ล่วงหน้าอัตโนมัติ
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => loadFinanceData(false)}
              disabled={isSyncing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs sm:text-sm font-semibold text-sky-200 hover:bg-sky-500/20 transition disabled:opacity-50"
              title="กดเพื่อดึงยอดล่าสุดทันที (ระบบมี Auto-Sync ทุก 10 วินาที)"
            >
              <span className={isSyncing ? "animate-spin inline-block" : ""}>🔄</span>
              <span>{isSyncing ? "กำลังซิงค์..." : "ซิงค์สด"}</span>
            </button>

            <button
              onClick={handleCopySummaryReport}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-3.5 py-2 text-xs sm:text-sm font-bold text-emerald-200 hover:bg-emerald-500/25 transition"
            >
              <span>📋</span>
              <span>
                {copiedSummary ? "คัดลอกสรุปแล้ว!" : "คัดลอกสรุปส่งให้เพื่อน"}
              </span>
            </button>

            <button
              onClick={() => {
                setEditNameA(settings.partner_a_name);
                setEditNameB(settings.partner_b_name);
                setShowSettingsModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-200 hover:bg-white/10 transition"
            >
              <span>⚙️</span>
              <span>ตั้งค่า / แก้ปัญหาซิงค์</span>
            </button>
          </div>
        </header>

        {/* ===================================================================
            HERO SETTLEMENT BANNER (ใครต้องโอนให้ใครตอนนี้)
        =================================================================== */}
        <section
          className={`rounded-2xl border p-5 sm:p-6 transition-all ${
            summary.settlementDirection === "EVEN"
              ? "border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-slate-900/80 to-slate-900/80"
              : "border-sky-500/40 bg-gradient-to-r from-sky-950/50 via-slate-900/85 to-indigo-950/40 shadow-lg shadow-sky-500/5"
          }`}
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-300">
                <span>⚖️ สถานะการเคลียร์เงินกองกลาง (หาร 2)</span>
              </div>

              {summary.settlementDirection === "EVEN" ? (
                <div>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-emerald-300">
                    ✅ ยอดเงินทั้งสองบัญชีหาร 2 ลงตัวเป๊ะแล้ว!
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                    ทั้ง <span className="text-white font-semibold">{settings.partner_a_name}</span> และ{" "}
                    <span className="text-white font-semibold">{settings.partner_b_name}</span> ได้รับส่วนแบ่งคนละ{" "}
                    <span className="text-emerald-300 font-bold">
                      ฿{formatMoney(summary.shareEach)}
                    </span>{" "}
                    ครบถ้วน ไม่มีติดค้างกัน
                  </p>
                </div>
              ) : summary.settlementDirection === "A_TO_B" ? (
                <div>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-white leading-snug">
                    💸{" "}
                    <span className="text-sky-300 underline decoration-sky-500/40 underline-offset-4">
                      {settings.partner_a_name}
                    </span>{" "}
                    ต้องโอนให้{" "}
                    <span className="text-amber-300 underline decoration-amber-500/40 underline-offset-4">
                      {settings.partner_b_name}
                    </span>{" "}
                    จำนวน{" "}
                    <span className="text-emerald-300 font-black tabular-nums">
                      ฿{formatMoney(summary.settlementAmount)}
                    </span>
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">
                    เนื่องจากยอดเงินลูกค้าที่เข้าบัญชี{" "}
                    <span className="text-slate-200 font-medium">
                      {settings.partner_a_name}
                    </span>{" "}
                    เกินกว่าส่วนแบ่ง 50% (฿{formatMoney(summary.shareEach)}) อยู่{" "}
                    <span className="text-sky-300 font-semibold">
                      ฿{formatMoney(summary.settlementAmount)}
                    </span>
                  </p>
                </div>
              ) : (
                <div>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-white leading-snug">
                    💸{" "}
                    <span className="text-amber-300 underline decoration-amber-500/40 underline-offset-4">
                      {settings.partner_b_name}
                    </span>{" "}
                    ต้องโอนให้{" "}
                    <span className="text-sky-300 underline decoration-sky-500/40 underline-offset-4">
                      {settings.partner_a_name}
                    </span>{" "}
                    จำนวน{" "}
                    <span className="text-emerald-300 font-black tabular-nums">
                      ฿{formatMoney(summary.settlementAmount)}
                    </span>
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">
                    เนื่องจากยอดเงินลูกค้าที่เข้าบัญชี{" "}
                    <span className="text-slate-200 font-medium">
                      {settings.partner_b_name}
                    </span>{" "}
                    เกินกว่าส่วนแบ่ง 50% (฿{formatMoney(summary.shareEach)}) อยู่{" "}
                    <span className="text-amber-300 font-semibold">
                      ฿{formatMoney(summary.settlementAmount)}
                    </span>
                  </p>
                </div>
              )}
            </div>

            {summary.settlementDirection !== "EVEN" && (
              <div className="shrink-0">
                <button
                  onClick={handleQuickSettle}
                  className="w-full md:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-xs sm:text-sm font-extrabold text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 transition"
                >
                  <span>⚡</span>
                  <span>
                    กดบันทึกโอนเคลียร์ยอด ฿{formatMoney(summary.settlementAmount)} ทันที
                  </span>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ===================================================================
            4 KPI OVERVIEW CARDS
        =================================================================== */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* 1. ยอดรายรับรวมทั้งหมด */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 sm:p-5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
              <span>รายรับจากลูกค้าทั้งหมด</span>
              <span className="rounded-lg bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                {summary.incomeCountA + summary.incomeCountB} งาน
              </span>
            </div>
            <p className="mt-2 text-2xl sm:text-3xl font-black text-white tabular-nums">
              ฿{formatMoney(summary.totalIncome)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              รวมทุกบัญชี ({settings.partner_a_name} + {settings.partner_b_name})
            </p>
          </div>

          {/* 2. ส่วนแบ่งคนละ 50% */}
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4 sm:p-5">
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-300">
              <span>ส่วนแบ่งคนละ 50% (หาร 2)</span>
              <span>✨ 50 : 50</span>
            </div>
            <p className="mt-2 text-2xl sm:text-3xl font-black text-emerald-300 tabular-nums">
              ฿{formatMoney(summary.shareEach)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              สิทธิ์ส่วนแบ่งสุทธิที่แต่ละคนได้รับ
            </p>
          </div>

          {/* 3. เบิกไปใช้ก่อนรวม */}
          <div className="rounded-2xl border border-amber-500/25 bg-amber-950/15 p-4 sm:p-5">
            <div className="flex items-center justify-between text-xs font-semibold text-amber-300">
              <span>เบิกเงินไปใช้ก่อนรวม</span>
              <span>🟠 เบิกล่วงหน้า</span>
            </div>
            <p className="mt-2 text-2xl sm:text-3xl font-black text-amber-200 tabular-nums">
              ฿{formatMoney(summary.totalAdvance)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {settings.partner_a_name}: ฿{formatMoney(summary.advanceUsedByA)} |{" "}
              {settings.partner_b_name}: ฿{formatMoney(summary.advanceUsedByB)}
            </p>
          </div>

          {/* 4. ค่าใช้จ่ายส่วนกลาง */}
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 sm:p-5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
              <span>กำไรสุทธิหลังหักต้นทุน</span>
              <span className="text-rose-300">
                ทุน -฿{formatMoney(summary.totalExpense)}
              </span>
            </div>
            <p className="mt-2 text-2xl sm:text-3xl font-black text-sky-200 tabular-nums">
              ฿{formatMoney(summary.netProfitPool)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              ยอดเงินกองกลางสำหรับนำมาหาร 2
            </p>
          </div>
        </section>

        {/* ===================================================================
            PARTNER BREAKDOWN CARDS (เรา vs เพื่อน แบบละเอียดชัดเจน)
        =================================================================== */}
        <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* PARTNER A CARD */}
          <div className="rounded-2xl border border-sky-500/30 bg-slate-900/75 p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3.5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/20 border border-sky-400/30 text-lg font-black text-sky-300">
                  A
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-extrabold text-white">
                    {settings.partner_a_name}
                  </h3>
                  <p className="text-xs text-slate-400">
                    ลูกค้าโอนเข้าบัญชีนี้ {summary.incomeCountA} รายการ
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  สิทธิ์ส่วนแบ่ง 50%
                </span>
                <p className="text-lg sm:text-xl font-black text-emerald-300 tabular-nums">
                  ฿{formatMoney(summary.shareEach)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <span className="text-xs text-slate-400">
                  🟢 ลูกค้าโอนเข้าบัญชีนี้
                </span>
                <p className="mt-1 text-lg font-extrabold text-white tabular-nums">
                  ฿{formatMoney(summary.incomeA)}
                </p>
              </div>

              <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 p-3">
                <span className="text-xs text-amber-300">
                  🟠 เบิกไปใช้ส่วนตัวแล้ว
                </span>
                <p className="mt-1 text-lg font-extrabold text-amber-200 tabular-nums">
                  ฿{formatMoney(summary.advanceUsedByA)}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-3.5 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-emerald-300">
                  💎 สิทธิ์ส่วนแบ่งคงเหลือ (หักที่เบิกไปใช้แล้ว)
                </p>
                <p className="text-[11px] text-slate-400">
                  คำนวณจาก: ส่วนแบ่ง ฿{formatMoney(summary.shareEach)} - เบิกใช้แล้ว ฿
                  {formatMoney(summary.advanceUsedByA)}
                </p>
              </div>
              <p
                className={`text-xl sm:text-2xl font-black tabular-nums ${
                  summary.remainingQuotaA >= 0
                    ? "text-emerald-300"
                    : "text-rose-400"
                }`}
              >
                ฿{formatMoney(summary.remainingQuotaA)}
              </p>
            </div>
          </div>

          {/* PARTNER B CARD */}
          <div className="rounded-2xl border border-amber-500/30 bg-slate-900/75 p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3.5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/20 border border-amber-400/30 text-lg font-black text-amber-300">
                  B
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-extrabold text-white">
                    {settings.partner_b_name}
                  </h3>
                  <p className="text-xs text-slate-400">
                    ลูกค้าโอนเข้าบัญชีนี้ {summary.incomeCountB} รายการ
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  สิทธิ์ส่วนแบ่ง 50%
                </span>
                <p className="text-lg sm:text-xl font-black text-emerald-300 tabular-nums">
                  ฿{formatMoney(summary.shareEach)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <span className="text-xs text-slate-400">
                  🟢 ลูกค้าโอนเข้าบัญชีนี้
                </span>
                <p className="mt-1 text-lg font-extrabold text-white tabular-nums">
                  ฿{formatMoney(summary.incomeB)}
                </p>
              </div>

              <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 p-3">
                <span className="text-xs text-amber-300">
                  🟠 เบิกไปใช้ส่วนตัวแล้ว
                </span>
                <p className="mt-1 text-lg font-extrabold text-amber-200 tabular-nums">
                  ฿{formatMoney(summary.advanceUsedByB)}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-3.5 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-emerald-300">
                  💎 สิทธิ์ส่วนแบ่งคงเหลือ (หักที่เบิกไปใช้แล้ว)
                </p>
                <p className="text-[11px] text-slate-400">
                  คำนวณจาก: ส่วนแบ่ง ฿{formatMoney(summary.shareEach)} - เบิกใช้แล้ว ฿
                  {formatMoney(summary.advanceUsedByB)}
                </p>
              </div>
              <p
                className={`text-xl sm:text-2xl font-black tabular-nums ${
                  summary.remainingQuotaB >= 0
                    ? "text-emerald-300"
                    : "text-rose-400"
                }`}
              >
                ฿{formatMoney(summary.remainingQuotaB)}
              </p>
            </div>
          </div>
        </section>

        {/* ===================================================================
            MAIN WORKSPACE: ADD TRANSACTION FORM + HISTORY LIST
        =================================================================== */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* LEFT: ADD TRANSACTION FORM (5 Cols) */}
          <div className="lg:col-span-5">
            <form
              onSubmit={handleAddTransaction}
              className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 sm:p-6 space-y-5 sticky top-6"
            >
              <div>
                <h2 className="text-base sm:text-lg font-extrabold text-white">
                  ➕ จดบันทึกรายการใหม่
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  เลือกประเภทรายการและระบุจำนวนเงิน ระบบจะคำนวณหาร 2 ให้อัตโนมัติ
                </p>
              </div>

              {/* 1. เลือกประเภทรายการ */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                  1. ประเภทรายการ
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTxType("income")}
                    className={`rounded-xl border p-3 text-left transition ${
                      txType === "income"
                        ? "border-emerald-400 bg-emerald-500/20 text-white shadow-sm"
                        : "border-white/10 bg-slate-950/60 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <div className="text-sm font-extrabold text-emerald-300">
                      🟢 ลูกค้าโอนเงิน
                    </div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      รายรับงานฟาร์ม (หาร 2)
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTxType("advance")}
                    className={`rounded-xl border p-3 text-left transition ${
                      txType === "advance"
                        ? "border-amber-400 bg-amber-500/20 text-white shadow-sm"
                        : "border-white/10 bg-slate-950/60 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <div className="text-sm font-extrabold text-amber-300">
                      🟠 เบิกเงินไปใช้ก่อน
                    </div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      ดึงส่วนแบ่งไปใช้ล่วงหน้า
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTxType("settlement")}
                    className={`rounded-xl border p-3 text-left transition ${
                      txType === "settlement"
                        ? "border-sky-400 bg-sky-500/20 text-white shadow-sm"
                        : "border-white/10 bg-slate-950/60 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <div className="text-sm font-extrabold text-sky-300">
                      🔵 โอนเคลียร์ยอด
                    </div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      โอนเงินส่วนต่างให้หุ้นส่วน
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTxType("expense")}
                    className={`rounded-xl border p-3 text-left transition ${
                      txType === "expense"
                        ? "border-rose-400 bg-rose-500/20 text-white shadow-sm"
                        : "border-white/10 bg-slate-950/60 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <div className="text-sm font-extrabold text-rose-300">
                      🔴 ค่าใช้จ่ายส่วนกลาง
                    </div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      ต้นทุนฟาร์ม (หักก่อนหาร 2)
                    </div>
                  </button>
                </div>
              </div>

              {/* 2. เลือกบัญชี / คนทำรายการ */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                  {txType === "income"
                    ? "2. ลูกค้าโอนเข้าบัญชีใคร?"
                    : txType === "advance"
                    ? "2. ใครเป็นคนเบิกเงินไปใช้ก่อน?"
                    : txType === "settlement"
                    ? "2. ใครเป็นคนโอนเงินเคลียร์ยอด?"
                    : "2. ใครเป็นคนออกค่าใช้จ่ายนี้ไปก่อน?"}
                </label>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setSelectedPartner("A")}
                    className={`rounded-xl border py-3 px-3.5 text-center font-bold transition ${
                      selectedPartner === "A"
                        ? "border-sky-400 bg-sky-500/20 text-sky-200"
                        : "border-white/10 bg-slate-950/60 text-slate-400 hover:text-white"
                    }`}
                  >
                    👤 {settings.partner_a_name}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPartner("B")}
                    className={`rounded-xl border py-3 px-3.5 text-center font-bold transition ${
                      selectedPartner === "B"
                        ? "border-amber-400 bg-amber-500/20 text-amber-200"
                        : "border-white/10 bg-slate-950/60 text-slate-400 hover:text-white"
                    }`}
                  >
                    👤 {settings.partner_b_name}
                  </button>
                </div>

                {txType === "settlement" && (
                  <p className="text-xs text-sky-300 pt-1">
                    ℹ️ รายการนี้:{" "}
                    <strong>
                      {selectedPartner === "A"
                        ? settings.partner_a_name
                        : settings.partner_b_name}
                    </strong>{" "}
                    โอนเงินให้{" "}
                    <strong>
                      {selectedPartner === "A"
                        ? settings.partner_b_name
                        : settings.partner_a_name}
                    </strong>
                  </p>
                )}
              </div>

              {/* ตัวเลือกเพิ่มเติมกรณี "เบิกเงินไปใช้ก่อน" */}
              {txType === "advance" && (
                <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-950/15 p-3.5">
                  <label className="block text-xs font-bold text-amber-200">
                    รูปแบบการเบิกเงินไปใช้ก่อน:
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      onClick={() => setAdvanceSource("other_partner_transfer")}
                      className={`rounded-lg border px-3 py-2.5 text-left text-xs transition ${
                        advanceSource === "other_partner_transfer"
                          ? "border-amber-400 bg-amber-500/25 text-white font-bold"
                          : "border-white/10 bg-slate-950/60 text-slate-400"
                      }`}
                    >
                      <div>💸 เบิกจากกองกลาง / อีกคนโอนให้เบิกก่อน (แนะนำ)</div>
                      <div className="text-[11px] opacity-80 font-normal mt-0.5">
                        หักออกจากยอดที่ต้องโอนเคลียร์ให้คนเบิก และหักส่วนแบ่งคงเหลือทันที
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdvanceSource("self_held")}
                      className={`rounded-lg border px-3 py-2.5 text-left text-xs transition ${
                        advanceSource === "self_held"
                          ? "border-amber-400 bg-amber-500/25 text-white font-bold"
                          : "border-white/10 bg-slate-950/60 text-slate-400"
                      }`}
                    >
                      <div>💳 เอาเงินลูกค้าในบัญชีตัวเองไปใช้ก่อน</div>
                      <div className="text-[11px] opacity-80 font-normal mt-0.5">
                        จดบันทึกว่าใช้เงินในบัญชีตัวเองไปแล้ว (ไม่ลดยอดที่อีกฝ่ายต้องโอนเคลียร์ให้)
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* 3. จำนวนเงิน */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                  3. จำนวนเงิน (บาท)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">
                    ฿
                  </span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-white/15 bg-slate-950 pl-10 pr-4 py-3 text-lg font-extrabold text-white placeholder-slate-600 focus:border-emerald-400 focus:outline-none tabular-nums"
                  />
                </div>

                {/* Quick Amount Pills */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[100, 200, 300, 500, 1000].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() =>
                        setAmountInput((prev) =>
                          String((parseFloat(prev) || 0) + val)
                        )
                      }
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition"
                    >
                      +{val}฿
                    </button>
                  ))}
                  {amountInput && (
                    <button
                      type="button"
                      onClick={() => setAmountInput("")}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition"
                    >
                      ล้างตัวเลข
                    </button>
                  )}
                </div>
              </div>

              {/* 4. ชื่อลูกค้า / หมายเหตุ */}
              <div className="space-y-3">
                {txType === "income" && (
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                      ชื่อลูกค้า (ไม่บังคับ)
                    </label>
                    <input
                      type="text"
                      value={customerInput}
                      onChange={(e) => setCustomerInput(e.target.value)}
                      placeholder="เช่น ลูกค้าคุณบอส, ลูกค้าในดิส..."
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                    รายละเอียด / หมายเหตุ
                  </label>
                  <input
                    type="text"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    placeholder={
                      txType === "income"
                        ? "เช่น ค่าจ้างฟาร์มเพชร 50k, ขายไอดี..."
                        : txType === "advance"
                        ? "เช่น เบิกไปใช้ส่วนตัวก่อน..."
                        : txType === "settlement"
                        ? "เช่น โอนเคลียร์ยอดประจำสัปดาห์..."
                        : "เช่น ค่าไฟ, ค่าไอดีไก่..."
                    }
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3.5 text-sm font-extrabold text-slate-950 shadow-lg shadow-emerald-500/20 hover:opacity-95 transition disabled:opacity-50"
              >
                {submitting ? "กำลังบันทึก..." : "💾 บันทึกรายการ"}
              </button>
            </form>
          </div>

          {/* RIGHT: TRANSACTION HISTORY LIST (7 Cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 sm:p-6 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base sm:text-lg font-extrabold text-white">
                    📜 ประวัติรายการทั้งหมด ({filteredTransactions.length})
                  </h2>
                  <p className="text-xs text-slate-400">
                    ตรวจสอบย้อนหลังได้ทุกรายการว่าใครรับโอน หรือใครเบิกไปใช้เมื่อไหร่
                  </p>
                </div>

                {transactions.length > 0 && (
                  <button
                    onClick={handleClearAllTransactions}
                    className="self-start sm:self-auto rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition"
                  >
                    🗑️ เริ่มรอบบัญชีใหม่ (ล้างประวัติ)
                  </button>
                )}
              </div>

              {/* Filters & Search */}
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/10 bg-slate-950 px-3 py-2">
                  <span className="text-slate-400 text-xs">🔍</span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ค้นหาชื่อลูกค้า, หมายเหตุ, จำนวนเงิน..."
                    className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none"
                  />
                </div>

                <select
                  value={filterType}
                  onChange={(e) =>
                    setFilterType(e.target.value as "ALL" | FinanceTxType)
                  }
                  className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-200 focus:outline-none"
                >
                  <option value="ALL">ทุกประเภท</option>
                  <option value="income">🟢 ลูกค้าโอนเงิน</option>
                  <option value="advance">🟠 เบิกไปใช้ก่อน</option>
                  <option value="settlement">🔵 โอนเคลียร์ยอด</option>
                  <option value="expense">🔴 ค่าใช้จ่าย</option>
                </select>

                <select
                  value={filterPartner}
                  onChange={(e) =>
                    setFilterPartner(e.target.value as "ALL" | PartnerId)
                  }
                  className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-200 focus:outline-none"
                >
                  <option value="ALL">ทุกคน</option>
                  <option value="A">👤 {settings.partner_a_name}</option>
                  <option value="B">👤 {settings.partner_b_name}</option>
                </select>
              </div>

              {/* Transaction List */}
              {loading ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  กำลังโหลดข้อมูลบัญชี...
                </div>
              ) : filteredTransactions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 py-14 px-4 text-center space-y-2">
                  <div className="text-3xl">📒</div>
                  <p className="text-sm sm:text-base font-bold text-white">
                    ยังไม่มีรายการบันทึกในระบบ
                  </p>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    เริ่มจดรายการแรกได้จากฟอร์มด้านซ้าย เช่น เมื่อลูกค้าโอนเงินเข้าบัญชีเราหรือบัญชีเพื่อน หรือเมื่อมีคนเบิกเงินไปใช้ก่อน
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[620px] overflow-y-auto pr-1">
                  {filteredTransactions.map((tx) => {
                    const partnerName =
                      tx.partner === "A"
                        ? settings.partner_a_name
                        : settings.partner_b_name;
                    const otherPartnerName =
                      tx.partner === "A"
                        ? settings.partner_b_name
                        : settings.partner_a_name;

                    const badgeConfig =
                      tx.type === "income"
                        ? {
                            icon: "🟢",
                            label: `ลูกค้าโอนเข้า: ${partnerName}`,
                            color:
                              "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                            amountColor: "text-emerald-300",
                            prefix: "+",
                          }
                        : tx.type === "advance"
                        ? {
                            icon: "🟠",
                            label: `${partnerName} เบิกไปใช้ก่อน`,
                            color:
                              "border-amber-500/30 bg-amber-500/10 text-amber-300",
                            amountColor: "text-amber-300",
                            prefix: "-",
                          }
                        : tx.type === "settlement"
                        ? {
                            icon: "🔵",
                            label: `${partnerName} โอนเคลียร์ให้ ${otherPartnerName}`,
                            color:
                              "border-sky-500/30 bg-sky-500/10 text-sky-300",
                            amountColor: "text-sky-300",
                            prefix: "⇄ ",
                          }
                        : {
                            icon: "🔴",
                            label: `ค่าใช้จ่าย (${partnerName} สำรองจ่าย)`,
                            color:
                              "border-rose-500/30 bg-rose-500/10 text-rose-300",
                            amountColor: "text-rose-300",
                            prefix: "-",
                          };

                    return (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/70 p-3.5 hover:border-white/20 transition"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${badgeConfig.color}`}
                            >
                              <span>{badgeConfig.icon}</span>
                              <span>{badgeConfig.label}</span>
                            </span>

                            {tx.type === "advance" &&
                              tx.advance_source ===
                                "other_partner_transfer" && (
                                <span className="rounded-md border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
                                  โอนจากบัญชี {otherPartnerName}
                                </span>
                              )}

                            <span className="text-[11px] text-slate-500">
                              {formatThaiDateTime(tx.created_at)}
                            </span>
                          </div>

                          <p className="text-sm font-bold text-white truncate">
                            {tx.customer_name ? (
                              <span className="text-cyan-300 mr-1.5">
                                [{tx.customer_name}]
                              </span>
                            ) : null}
                            {tx.note}
                          </p>

                          {tx.type === "income" && (
                            <p className="text-[11px] text-slate-400">
                              หาร 2 ได้คนละ:{" "}
                              <span className="text-emerald-300 font-semibold">
                                ฿{formatMoney(tx.amount / 2)}
                              </span>
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <p
                              className={`text-base sm:text-lg font-black tabular-nums ${badgeConfig.amountColor}`}
                            >
                              {badgeConfig.prefix}฿{formatMoney(tx.amount)}
                            </p>
                          </div>

                          <button
                            onClick={() => handleDeleteTransaction(tx.id)}
                            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-400 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300 transition"
                            title="ลบรายการนี้"
                          >
                            ลบ
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* ===================================================================
          MODAL: ตั้งชื่อหุ้นส่วน 2 คน
      =================================================================== */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSavePartnerNames}
            className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-white">
                ⚙️ ตั้งชื่อหุ้นส่วนทั้ง 2 คน
              </h3>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="text-sm text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-sky-300 mb-1">
                  ชื่อหุ้นส่วนคนที่ 1 (บัญชีเรา)
                </label>
                <input
                  type="text"
                  value={editNameA}
                  onChange={(e) => setEditNameA(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm font-bold text-white focus:border-sky-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-amber-300 mb-1">
                  ชื่อหุ้นส่วนคนที่ 2 (บัญชีเพื่อน)
                </label>
                <input
                  type="text"
                  value={editNameB}
                  onChange={(e) => setEditNameB(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm font-bold text-white focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-slate-300"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-extrabold text-slate-950 hover:bg-emerald-400"
              >
                บันทึกชื่อ
              </button>
            </div>

            <div className="pt-4 border-t border-white/10 space-y-2">
              <p className="text-xs font-bold text-slate-400">
                เครื่องมือแก้ปัญหายอดเงินไม่ตรงกับเพื่อน:
              </p>
              <button
                type="button"
                onClick={() => {
                  handleForceServerSync();
                  setShowSettingsModal(false);
                }}
                disabled={isSyncing}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/15 py-2.5 text-xs font-bold text-sky-200 hover:bg-sky-500/25 transition disabled:opacity-50"
              >
                <span>🔄</span>
                <span>{isSyncing ? "กำลังดึงข้อมูล..." : "ดึงข้อมูลสดจากเซิร์ฟเวอร์ใหม่ทั้งหมด (ล้างแคชเครื่องนี้)"}</span>
              </button>
              <p className="text-[11px] text-slate-500">
                หากหน้าจอของคุณกับเพื่อนยอดไม่เท่ากัน กดปุ่มนี้จะลบแคชเก่าในบราวเซอร์เครื่องนี้ทิ้ง แล้วดึงข้อมูลสดทั้งหมดจากเซิร์ฟเวอร์มาแสดงทันที
              </p>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
