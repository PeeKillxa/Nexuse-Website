"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type OrderStatus = "PENDING" | "FARMING" | "COMPLETED" | "CANCELLED";
export type PaymentStatus = "PAID" | "UNPAID" | "DEPOSIT";

export interface CustomerOrder {
  id: string;
  facebook_name: string;
  facebook_link?: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  target_item: string;
  price?: number;
  paid_status: PaymentStatus;
  order_status: OrderStatus;
  assigned_device?: string;
  handled_by?: string;
  note?: string;
  finance_tx_id?: string;
  finance_partner?: "A" | "B";
  created_at: number;
  updated_at: number;
}

export interface TelemetryBrief {
  user_id: number;
  username: string;
  display_name?: string;
  level: number;
  gems: number;
  april_coins: number;
  wins: number;
  disconnects: number;
  effective_status?: "ONLINE" | "OFFLINE";
  device_name?: string;
}

interface CustomerApiResponse {
  ok: boolean;
  error?: string;
  storage_mode?: string;
  orders?: CustomerOrder[];
  deleted_ids?: string[];
  updated_at?: number;
  state?: {
    orders: CustomerOrder[];
    deleted_ids?: string[];
    updated_at: number;
  };
}

const LOCAL_STORAGE_KEY = "nexus_customer_orders_v1";
const LOCAL_DELETED_KEY = "nexus_customer_deleted_v1";

const DEFAULT_EMU_OPTIONS = [
  "PC",
  "Android Device",
  "Android Device-1",
  "Android Device-2",
  "Android Device-3",
  "Android Device-4",
  "Android Device-5",
];

function formatMoney(amount?: number): string {
  const num = Number(amount || 0);
  return num.toLocaleString("th-TH", {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatNumber(val?: number): string {
  return Number(val || 0).toLocaleString("en-US");
}

function formatCompact(val?: number): string {
  const n = Number(val || 0);
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toString();
}

function formatThaiDate(epochSec: number): string {
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

export default function CustomersPage() {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [storageMode, setStorageMode] = useState<string>("unknown");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number>(0);
  const [syncingOrders, setSyncingOrders] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Live Telemetry from /api/telemetry for real-time bot checking
  const [liveBots, setLiveBots] = useState<Record<string, TelemetryBrief>>({});

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [paymentFilter, setPaymentFilter] = useState<string>("ALL");

  // Modal State for Add / Edit
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editingOrder, setEditingOrder] = useState<CustomerOrder | null>(null);

  // Form Fields
  const [formFbName, setFormFbName] = useState<string>("");
  const [formFbLink, setFormFbLink] = useState<string>("");
  const [formUsername, setFormUsername] = useState<string>("");
  const [formTargetItem, setFormTargetItem] = useState<string>("");
  const [formPrice, setFormPrice] = useState<string>("");
  const [formPaidStatus, setFormPaidStatus] = useState<PaymentStatus>("UNPAID");
  const [formOrderStatus, setFormOrderStatus] = useState<OrderStatus>("FARMING");
  const [formDevice, setFormDevice] = useState<string>("Android Device-5");
  const [formHandledBy, setFormHandledBy] = useState<string>("บ๊วย");
  const [formPartner, setFormPartner] = useState<"A" | "B">("B");
  const [formSyncFinance, setFormSyncFinance] = useState<boolean>(true);
  const [formNote, setFormNote] = useState<string>("");
  const [savingForm, setSavingForm] = useState<boolean>(false);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  const persistLocal = useCallback(
    (items: CustomerOrder[], deletedIds?: string[]) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
      if (deletedIds) {
        localStorage.setItem(LOCAL_DELETED_KEY, JSON.stringify(deletedIds));
      }
    } catch {
      // ignore
    }
    },
    []
  );

  // Load the shared customer state and merge this browser's old backup into it.
  const loadOrders = useCallback(async () => {
    let localOrders: CustomerOrder[] = [];
    let localDeleted: string[] = [];
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          localOrders = parsed;
        }
      }
      const deletedRaw = localStorage.getItem(LOCAL_DELETED_KEY);
      if (deletedRaw) {
        const parsedDeleted = JSON.parse(deletedRaw);
        if (Array.isArray(parsedDeleted)) {
          localDeleted = parsedDeleted.map(String).filter(Boolean);
        }
      }
      const localDeletedSet = new Set(localDeleted);
      setOrders(localOrders.filter((order) => !localDeletedSet.has(order.id)));
    } catch {
      // ignore
    }

    try {
      const res = await fetch("/api/customers", { cache: "no-store" });
      const data = (await res.json()) as CustomerApiResponse;
      if (!res.ok || !data.ok || !Array.isArray(data.orders)) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const serverOrders = data.orders;
      const serverDeleted = Array.isArray(data.deleted_ids)
        ? data.deleted_ids
        : [];
      const deleted = new Set([...serverDeleted, ...localDeleted]);
      const mergedById = new Map<string, CustomerOrder>();

      for (const order of serverOrders) {
        if (order?.id && !deleted.has(order.id)) {
          mergedById.set(order.id, order);
        }
      }
      for (const order of localOrders) {
        if (!order?.id || deleted.has(order.id)) continue;
        const current = mergedById.get(order.id);
        if (!current || (order.updated_at || 0) > (current.updated_at || 0)) {
          mergedById.set(order.id, order);
        }
      }

      const mergedOrders = Array.from(mergedById.values()).sort(
        (a, b) => (b.created_at || 0) - (a.created_at || 0)
      );
      const serverById = new Map(serverOrders.map((order) => [order.id, order]));
      const hasLocalOrderChanges = mergedOrders.some(
        (order) => JSON.stringify(serverById.get(order.id)) !== JSON.stringify(order)
      );
      const hasNewDeletions = Array.from(deleted).some(
        (id) => !serverDeleted.includes(id)
      );
      const hasDeletedServerOrders = serverOrders.some((order) => deleted.has(order.id));

      let finalOrders = mergedOrders;
      let finalDeleted = Array.from(deleted);
      let finalStorageMode = data.storage_mode || "in-memory";

      if (hasLocalOrderChanges || hasNewDeletions || hasDeletedServerOrders) {
        const syncRes = await fetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "sync_client_state",
            state: {
              orders: mergedOrders,
              deleted_ids: finalDeleted,
              updated_at: Math.floor(Date.now() / 1000),
            },
          }),
        });
        const syncData = (await syncRes.json()) as CustomerApiResponse;
        if (!syncRes.ok || !syncData.ok) {
          throw new Error(syncData.error || `HTTP ${syncRes.status}`);
        }
        finalOrders = syncData.orders || syncData.state?.orders || mergedOrders;
        finalDeleted = syncData.deleted_ids || syncData.state?.deleted_ids || finalDeleted;
        finalStorageMode = syncData.storage_mode || finalStorageMode;
      }

      setOrders(finalOrders);
      setStorageMode(finalStorageMode);
      setSyncError(null);
      setLastSyncedAt(Date.now());
      persistLocal(finalOrders, finalDeleted);
    } catch (error) {
      setStorageMode("error");
      setSyncError(
        error instanceof Error
          ? `ซิงก์ข้อมูลลูกค้าไม่สำเร็จ: ${error.message}`
          : "ซิงก์ข้อมูลลูกค้าไม่สำเร็จ ข้อมูลสำรองในเครื่องยังอยู่"
      );
    } finally {
      setLoading(false);
    }
  }, [persistLocal]);

  // Fetch telemetry to cross-reference customer usernames with online farm bots
  const loadTelemetry = useCallback(async () => {
    try {
      const res = await fetch("/api/telemetry", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.accounts)) {
          const map: Record<string, TelemetryBrief> = {};
          data.accounts.forEach((acc: TelemetryBrief) => {
            if (acc.username) {
              map[acc.username.toLowerCase()] = acc;
            }
          });
          setLiveBots(map);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadOrders();
    loadTelemetry();
    const telemetryTimer = setInterval(() => {
      loadTelemetry();
    }, 12000);
    const ordersTimer = setInterval(() => {
      loadOrders();
    }, 30000);
    return () => {
      clearInterval(telemetryTimer);
      clearInterval(ordersTimer);
    };
  }, [loadOrders, loadTelemetry]);

  const handleSyncOrdersNow = async () => {
    setSyncingOrders(true);
    try {
      await loadOrders();
    } finally {
      setSyncingOrders(false);
    }
  };

  // Open Add Modal
  const handleOpenAddModal = (initialUsername = "", initialDevice = "Android Device-5") => {
    setEditingOrder(null);
    setFormFbName("");
    setFormFbLink("");
    setFormUsername(initialUsername);
    setFormTargetItem("");
    setFormPrice("");
    setFormPaidStatus("UNPAID");
    setFormOrderStatus("FARMING");
    setFormDevice(initialDevice);
    setFormPartner("B");
    setFormSyncFinance(true);
    setFormHandledBy("บ๊วย");
    setFormNote("");
    setShowModal(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (order: CustomerOrder) => {
    setEditingOrder(order);
    setFormFbName(order.facebook_name || "");
    setFormFbLink(order.facebook_link || "");
    setFormUsername(order.username || "");
    setFormTargetItem(order.target_item || "");
    setFormPrice(order.price !== undefined && order.price > 0 ? String(order.price) : "");
    setFormPaidStatus(order.paid_status || "UNPAID");
    setFormOrderStatus(order.order_status || "FARMING");
    setFormDevice(order.assigned_device || "PC");
    setFormPartner(order.finance_partner || "B");
    setFormSyncFinance(Boolean(order.finance_tx_id) || true);
    setFormHandledBy(order.handled_by || (order.finance_partner === "A" ? "พี" : "บ๊วย"));
    setFormNote(order.note || "");
    setShowModal(true);
  };

  // Submit Form (Add or Edit)
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formFbName.trim() || !formUsername.trim() || !formTargetItem.trim()) {
      showToast("⚠️ กรุณากรอกชื่อเฟส, Roblox Username และของที่หา");
      return;
    }

    setSavingForm(true);
    try {
      const isEdit = Boolean(editingOrder);
      const action = isEdit ? "update_customer" : "add_customer";
      const payload: Record<string, unknown> = {
        action,
        facebook_name: formFbName.trim(),
        facebook_link: formFbLink.trim(),
        username: formUsername.trim(),
        target_item: formTargetItem.trim(),
        price: formPrice ? Number(formPrice) : 0,
        paid_status: formPaidStatus,
        order_status: formOrderStatus,
        assigned_device: formDevice.trim() || "PC",
        handled_by: formHandledBy.trim() || (formPartner === "B" ? "บ๊วย" : "พี"),
        finance_partner: formPartner,
        sync_to_finance: formSyncFinance,
        note: formNote.trim(),
      };

      if (isEdit && editingOrder) {
        payload.id = editingOrder.id;
      }

      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.ok && Array.isArray(data.orders)) {
        setOrders(data.orders);
        persistLocal(data.orders);
        setShowModal(false);
        showToast(
          isEdit
            ? `✅ อัปเดตข้อมูลลูกค้า "${formFbName}" เรียบร้อย`
            : `🎉 เพิ่มลูกค้า "${formFbName}" (@${formUsername}) เข้าระบบแล้ว!`
        );
      } else {
        showToast(`❌ เกิดข้อผิดพลาด: ${data.error || "ไม่สามารถบันทึกได้"}`);
      }
    } catch {
      showToast("❌ เครือข่ายขัดข้อง กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSavingForm(false);
    }
  };

  // 1-Click Sync to Finance 50/50
  const handleSyncToFinance = async (
    order: CustomerOrder,
    partner: "A" | "B" = "B"
  ) => {
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync_to_finance",
          id: order.id,
          finance_partner: partner,
        }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.orders)) {
        setOrders(data.orders);
        persistLocal(data.orders);
        showToast(
          `💰 ส่งยอด ฿${formatMoney(order.price)} เข้าบัญชีหาร 2 (${
            partner === "A" ? "พี" : "บ๊วย"
          }) เรียบร้อย!`
        );
      } else {
        showToast(`❌ ซิงค์ไม่สำเร็จ: ${data.error || "ข้อผิดพลาด"}`);
      }
    } catch {
      showToast("❌ เครือข่ายขัดข้อง ไม่สามารถซิงค์ได้");
    }
  };

  // Unlink from Finance
  const handleUnlinkFinance = async (order: CustomerOrder) => {
    if (
      !confirm(
        `ต้องการยกเลิกการลิ้งค์รายการของ "${order.facebook_name}" ออกจากระบบหาร 2 ใช่หรือไม่?`
      )
    ) {
      return;
    }
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "unlink_finance",
          id: order.id,
        }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.orders)) {
        setOrders(data.orders);
        persistLocal(data.orders);
        showToast("🔗 ปลดการเชื่อมโยงกับระบบคำนวณเงินแล้ว");
      }
    } catch {
      showToast("❌ เกิดข้อผิดพลาด");
    }
  };

  // Delete Order
  const handleDeleteOrder = async (order: CustomerOrder) => {
    if (
      !confirm(
        `ต้องการลบรายการของ "${order.facebook_name}" (@${order.username}) ใช่หรือไม่?`
      )
    ) {
      return;
    }

    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_customer", id: order.id }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.orders)) {
        setOrders(data.orders);
        persistLocal(data.orders, data.deleted_ids);
        showToast(`🗑️ ลบข้อมูลของ ${order.facebook_name} เรียบร้อย`);
      }
    } catch {
      showToast("❌ ลบไม่สำเร็จ");
    }
  };

  // Quick Status Toggle
  const handleQuickStatusChange = async (
    order: CustomerOrder,
    newStatus: OrderStatus
  ) => {
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_customer",
          id: order.id,
          order_status: newStatus,
        }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.orders)) {
        setOrders(data.orders);
        persistLocal(data.orders);
        showToast(`⚡ ปรับสถานะเป็น "${newStatus}" แล้ว`);
      }
    } catch {
      // ignore
    }
  };

  // Quick Paid Status Toggle
  const handleQuickPaidToggle = async (order: CustomerOrder) => {
    const nextStatus: PaymentStatus =
      order.paid_status === "PAID"
        ? "UNPAID"
        : order.paid_status === "UNPAID"
        ? "PAID"
        : "PAID";

    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_customer",
          id: order.id,
          paid_status: nextStatus,
        }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.orders)) {
        setOrders(data.orders);
        persistLocal(data.orders);
        showToast(
          nextStatus === "PAID"
            ? `🟢 ปรับเป็น "โอนแล้ว" (+฿${formatMoney(order.price)})`
            : `🟡 ปรับเป็น "ยังไม่โอน"`
        );
      }
    } catch {
      // ignore
    }
  };

  // Format & Copy Order Summary for Facebook Chat
  const handleCopyCustomerChat = (order: CustomerOrder) => {
    const liveBot = liveBots[order.username.toLowerCase()];
    const statusThai =
      order.order_status === "COMPLETED"
        ? "✅ เสร็จสิ้นเรียบร้อยแล้วครับ!"
        : order.order_status === "FARMING"
        ? "🚀 กำลังฟาร์มอย่างต่อเนื่อง"
        : order.order_status === "PENDING"
        ? "⏳ รอดำเนินการเข้าฟาร์ม"
        : "❌ ยกเลิก";

    const paymentThai =
      order.paid_status === "PAID"
        ? "ชำระเงินเรียบร้อยแล้ว (ขอบคุณครับ 🙏)"
        : order.paid_status === "DEPOSIT"
        ? "มัดจำแล้วบางส่วน"
        : "รอการชำระเงิน";

    let text = `🎮 สรุปออเดอร์ฟาร์ม Anime Adventures\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `👤 ลูกค้า: คุณ ${order.facebook_name}\n`;
    text += `🆔 ไอดี Roblox: @${order.username} (${order.display_name || order.username})\n`;
    text += `🎯 เป้าหมายที่หา: ${order.target_item}\n`;
    text += `📊 สถานะงาน: ${statusThai}\n`;

    if (liveBot) {
      text += `💎 เพชรปัจจุบันในตัว: ${formatNumber(liveBot.gems)} Gems\n`;
      text += `⭐ เลเวลปัจจุบัน: Lv.${liveBot.level}\n`;
      if (liveBot.april_coins > 0) {
        text += `🌸 AprilCoins: ${formatNumber(liveBot.april_coins)}\n`;
      }
      text += `🏆 ชนะด่านสะสม: ${liveBot.wins} รอบ\n`;
      text += `🟢 สถานะในเกม: ออนไลน์ฟาร์มอยู่ (จอ ${order.assigned_device || liveBot.device_name || "Emu"})\n`;
    }

    if (order.price && order.price > 0) {
      text += `💰 ยอดชำระ: ${formatMoney(order.price)} บาท (${paymentThai})\n`;
    }

    if (order.note) {
      text += `📝 บันทึก: ${order.note}\n`;
    }
    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `⚡ ตรวจสอบและฟาร์มโดย Nexus Auto Farm Studio`;

    navigator.clipboard.writeText(text);
    setCopiedId(order.id);
    setTimeout(() => setCopiedId(null), 2500);
    showToast(`📋 คัดลอกข้อความสรุปส่ง ${order.facebook_name} ในแชทแล้ว!`);
  };

  // Compute Summary Statistics
  const summary = useMemo(() => {
    return orders.reduce(
      (acc, ord) => {
        acc.total_orders += 1;
        if (ord.order_status === "FARMING") acc.farming_count += 1;
        if (ord.order_status === "COMPLETED") acc.completed_count += 1;
        if (ord.order_status === "PENDING") acc.pending_count += 1;

        const p = Number(ord.price || 0);
        acc.total_value += p;
        if (ord.paid_status === "PAID") acc.total_paid += p;
        if (ord.paid_status === "UNPAID") acc.total_unpaid += p;
        return acc;
      },
      {
        total_orders: 0,
        farming_count: 0,
        completed_count: 0,
        pending_count: 0,
        total_value: 0,
        total_paid: 0,
        total_unpaid: 0,
      }
    );
  }, [orders]);

  // Filtered Orders
  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== "ALL" && o.order_status !== statusFilter) return false;
      if (paymentFilter !== "ALL" && o.paid_status !== paymentFilter) return false;

      if (!q) return true;
      return (
        o.facebook_name.toLowerCase().includes(q) ||
        o.username.toLowerCase().includes(q) ||
        (o.display_name && o.display_name.toLowerCase().includes(q)) ||
        o.target_item.toLowerCase().includes(q) ||
        (o.assigned_device && o.assigned_device.toLowerCase().includes(q)) ||
        (o.handled_by && o.handled_by.toLowerCase().includes(q))
      );
    });
  }, [orders, searchQuery, statusFilter, paymentFilter]);

  return (
    <div className="min-h-screen bg-[#070913] text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Background Ambient Glow */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-96 bg-gradient-to-b from-cyan-500/[0.06] via-purple-500/[0.03] to-transparent" />

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 rounded-2xl border border-cyan-400/40 bg-slate-900/95 px-4 py-3 text-sm font-semibold text-cyan-200 shadow-2xl backdrop-blur-xl animate-fade-in">
          {toastMsg}
        </div>
      )}

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* ===================================================================
            HERO HEADER & ACTIONS
        =================================================================== */}
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between rounded-3xl border border-white/10 bg-slate-900/70 p-5 sm:p-6 backdrop-blur-xl">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-500/15 px-3 py-0.5 text-xs font-bold text-cyan-300">
                <span>👥 CUSTOMER DATABASE</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-purple-400/30 bg-purple-500/10 px-2.5 py-0.5 text-xs font-semibold text-purple-300">
                <span>⚡ Real-Time Live Sync</span>
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-black tracking-tight text-white">
              ระบบจัดการบัญชีและออเดอร์ลูกค้า
            </h1>
            <p className="text-xs sm:text-sm text-slate-400">
              จดบันทึกชื่อเฟสลูกค้า, Username Roblox, ของที่ต้องหา, ยอดเงิน, และจอ Emu ที่รับผิดชอบฟาร์ม
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleSyncOrdersNow}
              disabled={syncingOrders}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
            >
              <span aria-hidden="true">↻</span>
              <span>{syncingOrders ? "กำลังซิงก์..." : "ซิงก์ข้อมูล"}</span>
            </button>
            <button
              onClick={() => handleOpenAddModal()}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/50 bg-gradient-to-r from-cyan-500/25 to-blue-600/25 px-4 py-2.5 text-xs sm:text-sm font-bold text-cyan-100 hover:bg-cyan-500/35 transition shadow-lg shadow-cyan-500/15"
            >
              <span>＋</span>
              <span>เพิ่มออเดอร์ลูกค้าใหม่</span>
            </button>

            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-300 hover:bg-white/10 transition"
            >
              <span>📡 จอภาพบอท</span>
            </Link>
          </div>
        </header>

        {storageMode === "vercel-kv" && !syncError && (
          <section
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.04] px-4 py-2.5 text-xs text-emerald-100/90"
          >
            <span>บัญชีลูกค้ากำลังแชร์ผ่านฐานข้อมูลกลาง และซิงก์อัตโนมัติทุก 30 วินาที</span>
            <span className="text-emerald-100/60">
              ซิงก์ล่าสุด {lastSyncedAt ? formatThaiDate(Math.floor(lastSyncedAt / 1000)) : "-"}
            </span>
          </section>
        )}

        {storageMode === "in-memory" && (
          <section
            role="alert"
            className="rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-100"
          >
            <p className="font-semibold">ยังไม่ได้เชื่อมฐานข้อมูลกลาง</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
              รายการลูกค้าอาจไม่ตรงกันระหว่างเครื่อง กรุณาตรวจการเชื่อมต่อ Upstash ใน Vercel
            </p>
          </section>
        )}

        {syncError && (
          <section
            role="alert"
            className="rounded-xl border border-rose-400/25 bg-rose-400/[0.06] px-4 py-3 text-sm text-rose-100"
          >
            {syncError} ข้อมูลสำรองในเบราว์เซอร์นี้ยังไม่ถูกลบ
          </section>
        )}

        {/* ===================================================================
            SUMMARY CARDS (4 Glass Cards)
        =================================================================== */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
          {/* 1. Total Orders */}
          <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-cyan-950/30 p-4 shadow-lg shadow-cyan-500/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                ลูกค้าทั้งหมด
              </span>
              <span className="text-lg">👥</span>
            </div>
            <p className="mt-2 text-2xl sm:text-3xl font-black text-white tabular-nums">
              {summary.total_orders}{" "}
              <span className="text-xs font-semibold text-slate-400">ราย</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              รอดำเนินการ {summary.pending_count} ราย
            </p>
          </div>

          {/* 2. Farming Now */}
          <div className="rounded-2xl border border-purple-500/35 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-purple-950/35 p-4 shadow-lg shadow-purple-500/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-300">
                กำลังฟาร์มอยู่
              </span>
              <span className="text-lg">🚀</span>
            </div>
            <p className="mt-2 text-2xl sm:text-3xl font-black text-purple-200 tabular-nums">
              {summary.farming_count}{" "}
              <span className="text-xs font-semibold text-purple-300/80">จอ</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              เชื่อมกับ Telemetry สดอัตโนมัติ
            </p>
          </div>

          {/* 3. Completed */}
          <div className="rounded-2xl border border-emerald-500/35 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-emerald-950/35 p-4 shadow-lg shadow-emerald-500/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                ฟาร์มเสร็จแล้ว
              </span>
              <span className="text-lg">✅</span>
            </div>
            <p className="mt-2 text-2xl sm:text-3xl font-black text-emerald-200 tabular-nums">
              {summary.completed_count}{" "}
              <span className="text-xs font-semibold text-emerald-300/80">ราย</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              พร้อมส่งมอบงานให้ลูกค้า
            </p>
          </div>

          {/* 4. Total Value / Unpaid */}
          <div className="rounded-2xl border border-amber-500/35 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-amber-950/35 p-4 shadow-lg shadow-amber-500/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                ยอดเงินรวม
              </span>
              <span className="text-lg">💰</span>
            </div>
            <p className="mt-2 text-2xl sm:text-3xl font-black text-amber-200 tabular-nums">
              ฿{formatMoney(summary.total_value)}
            </p>
            <p className="mt-1 text-[11px] flex items-center justify-between">
              <span className="text-emerald-400">โอนแล้ว ฿{formatMoney(summary.total_paid)}</span>
              {summary.total_unpaid > 0 && (
                <span className="text-rose-400 font-bold">ค้าง ฿{formatMoney(summary.total_unpaid)}</span>
              )}
            </p>
          </div>
        </section>

        {/* ===================================================================
            TOOLBAR: SEARCH & FILTERS
        =================================================================== */}
        <section className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur-xl">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
              🔍
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อเฟส, Roblox Username, หรือของที่หา..."
              className="w-full rounded-xl border border-white/10 bg-slate-950/80 py-2 pl-10 pr-4 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          {/* Status & Payment Tabs */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter */}
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-slate-950 p-1 text-xs">
              {[
                { id: "ALL", label: "ทั้งหมด" },
                { id: "FARMING", label: "🚀 กำลังฟาร์ม" },
                { id: "PENDING", label: "⏳ รอดำเนินการ" },
                { id: "COMPLETED", label: "✅ เสร็จแล้ว" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    statusFilter === tab.id
                      ? "bg-cyan-500/25 border border-cyan-400/40 text-cyan-200"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Payment Filter */}
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-slate-950 p-1 text-xs">
              {[
                { id: "ALL", label: "เงิน: ทั้งหมด" },
                { id: "PAID", label: "🟢 โอนแล้ว" },
                { id: "UNPAID", label: "🟡 ยังไม่โอน" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setPaymentFilter(tab.id)}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    paymentFilter === tab.id
                      ? "bg-amber-500/25 border border-amber-400/40 text-amber-200"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ===================================================================
            CUSTOMER ORDERS LIST
        =================================================================== */}
        {loading ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/50 p-16 text-center text-sm text-slate-400">
            ⏳ กำลังโหลดรายการลูกค้า...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/15 bg-slate-900/30 p-16 text-center space-y-3">
            <div className="text-4xl">👥</div>
            <h3 className="text-base sm:text-lg font-extrabold text-white">
              {orders.length === 0
                ? "ยังไม่มีรายการลูกค้าในระบบ"
                : "ไม่พบรายการลูกค้าที่ตรงกับคำค้นหา"}
            </h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              กดปุ่ม &ldquo;เพิ่มออเดอร์ลูกค้าใหม่&rdquo; ด้านบน เพื่อเริ่มบันทึกชื่อเฟส Username และของที่ลูกค้าสั่งฟาร์ม
            </p>
            {orders.length === 0 && (
              <button
                onClick={() => handleOpenAddModal()}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/20 px-4 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/30 transition"
              >
                <span>＋</span>
                <span>สร้างรายการแรกเลย</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filteredOrders.map((order) => {
              const liveBot = liveBots[order.username.toLowerCase()];
              const isOnline = liveBot?.effective_status === "ONLINE";

              return (
                <div
                  key={order.id}
                  className={`group relative overflow-hidden rounded-3xl border p-5 backdrop-blur-xl transition-all space-y-4 ${
                    order.order_status === "COMPLETED"
                      ? "border-emerald-500/35 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-emerald-950/20"
                      : order.order_status === "FARMING"
                      ? "border-cyan-500/35 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-cyan-950/20"
                      : "border-white/10 bg-slate-900/75"
                  }`}
                >
                  {/* Card Top: Customer Facebook & Roblox Avatar */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="relative shrink-0">
                        <img
                          src={
                            order.avatar_url ||
                            `https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=png`
                          }
                          alt={order.username}
                          className="h-14 w-14 rounded-2xl border border-white/15 bg-slate-950 object-cover shadow-md"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src =
                              "https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=png";
                          }}
                        />
                        {/* Live indicator pip */}
                        {liveBot && (
                          <span
                            className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-slate-900 ${
                              isOnline ? "bg-emerald-400 animate-pulse" : "bg-rose-500"
                            }`}
                            title={isOnline ? "บอทกำลังออนไลน์" : "บอทออฟไลน์"}
                          />
                        )}
                      </div>

                      <div className="min-w-0">
                        {/* Facebook Name */}
                        <div className="flex items-center gap-2">
                          <span className="text-base sm:text-lg font-black text-white truncate">
                            {order.facebook_name}
                          </span>
                          {order.facebook_link && (
                            <a
                              href={order.facebook_link}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-blue-400 hover:text-blue-300"
                              title="เปิดลิงก์โปรไฟล์เฟสบุ๊ค"
                            >
                              🔗
                            </a>
                          )}
                        </div>

                        {/* Roblox Username & DisplayName */}
                        <div className="flex items-center gap-1.5 text-xs text-slate-300 mt-0.5">
                          <span className="font-bold text-cyan-300">
                            @{order.username}
                          </span>
                          {order.display_name &&
                            order.display_name !== order.username && (
                              <span className="text-slate-400 truncate">
                                ({order.display_name})
                              </span>
                            )}
                        </div>

                        {/* Badges: Assigned Emu + Handled By */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          {/* Device / Emu Badge */}
                          <span className="inline-flex items-center gap-1 rounded-md border border-purple-400/35 bg-purple-500/15 px-2 py-0.5 text-[11px] font-bold text-purple-200">
                            <span>
                              {order.assigned_device?.startsWith("Android")
                                ? "📱"
                                : "💻"}
                            </span>
                            <span>{order.assigned_device || "PC"}</span>
                          </span>

                          {/* Handled By */}
                          {order.handled_by && (
                            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                              คนรับ: {order.handled_by}
                            </span>
                          )}

                          {/* 🔗 Finance 50/50 Linked Badge */}
                          {order.finance_tx_id ? (
                            <Link
                              href="/finance"
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/25 transition shadow-sm"
                              title="ลิ้งค์เข้าหน้าคำนวณเงินหาร 2 แล้ว คลิกเพื่อไปดู"
                            >
                              <span>💰 บัญชีหาร 2 ({order.finance_partner === "A" ? "เข้าพี" : "เข้าบ๊วย"})</span>
                              <span className="text-emerald-400">↗</span>
                            </Link>
                          ) : (
                            order.price !== undefined && order.price > 0 && (
                              <button
                                type="button"
                                onClick={() => handleSyncToFinance(order, "B")}
                                className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300 hover:bg-amber-500/25 transition shadow-sm"
                                title="คลิกเพื่อส่งยอดนี้เข้าหน้าคำนวณเงินหาร 2 ทันที (เงินโอนเข้าบ๊วย)"
                              >
                                <span>⚡ ลิ้งค์เข้าบัญชีหาร 2 (บ๊วย)</span>
                              </button>
                            )
                          )}

                          <span className="text-[10px] text-slate-500">
                            {formatThaiDate(order.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Status & Price Pill */}
                    <div className="text-right shrink-0 space-y-1.5">
                      {/* Order Status */}
                      <div>
                        {order.order_status === "FARMING" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/40 bg-cyan-500/20 px-2.5 py-0.5 text-xs font-black text-cyan-300 animate-pulse">
                            <span>🚀</span>
                            <span>กำลังฟาร์ม</span>
                          </span>
                        )}
                        {order.order_status === "COMPLETED" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2.5 py-0.5 text-xs font-black text-emerald-300">
                            <span>✅</span>
                            <span>สำเร็จแล้ว</span>
                          </span>
                        )}
                        {order.order_status === "PENDING" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/20 px-2.5 py-0.5 text-xs font-black text-amber-300">
                            <span>⏳</span>
                            <span>รอดำเนินการ</span>
                          </span>
                        )}
                        {order.order_status === "CANCELLED" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/20 px-2.5 py-0.5 text-xs font-black text-rose-300">
                            <span>❌</span>
                            <span>ยกเลิก</span>
                          </span>
                        )}
                      </div>

                      {/* Payment Status Button */}
                      <div>
                        <button
                          type="button"
                          onClick={() => handleQuickPaidToggle(order)}
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-black border transition ${
                            order.paid_status === "PAID"
                              ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                              : order.paid_status === "DEPOSIT"
                              ? "border-amber-400/50 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                              : "border-rose-400/50 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                          }`}
                          title="กดเพื่อสลับสถานะการจ่ายเงิน (โอนแล้ว / ยังไม่โอน)"
                        >
                          {order.paid_status === "PAID"
                            ? "🟢 โอนแล้ว"
                            : order.paid_status === "DEPOSIT"
                            ? "🟠 มัดจำแล้ว"
                            : "🟡 ยังไม่โอน"}
                        </button>
                      </div>

                      {order.price !== undefined && order.price > 0 && (
                        <p className="text-sm font-extrabold text-amber-300">
                          ฿{formatMoney(order.price)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Target Item / Goal Box */}
                  <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3.5 space-y-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <span>🎯 ของที่หา / เป้าหมาย</span>
                    </span>
                    <p className="text-sm sm:text-base font-extrabold text-cyan-200">
                      {order.target_item}
                    </p>
                    {order.note && (
                      <p className="text-xs text-slate-400 italic mt-1">
                        หมายเหตุ: {order.note}
                      </p>
                    )}
                  </div>

                  {/* ⚡ Live Farm Telemetry Bridge Box */}
                  {liveBot ? (
                    <div
                      className={`rounded-2xl border p-3 flex flex-wrap items-center justify-between gap-3 ${
                        isOnline
                          ? "border-emerald-500/35 bg-emerald-950/20 text-emerald-200"
                          : "border-rose-500/35 bg-rose-950/20 text-rose-200"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            isOnline ? "bg-emerald-400 animate-ping" : "bg-rose-500"
                          }`}
                        />
                        <span className="text-xs font-bold">
                          {isOnline ? "🟢 บอทกำลังออนไลน์" : "🔴 บอทออฟไลน์"}
                        </span>
                        <span className="text-xs font-mono text-slate-300">
                          (จอ {liveBot.device_name || order.assigned_device || "PC"})
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs font-bold">
                        <span className="text-cyan-300">
                          💎 {formatNumber(liveBot.gems)}
                        </span>
                        {liveBot.april_coins > 0 && (
                          <span className="text-pink-300">
                            🌸 {formatNumber(liveBot.april_coins)}
                          </span>
                        )}
                        <span className="text-purple-300">
                          ⭐ Lv.{liveBot.level}
                        </span>
                        <span className="text-amber-300">
                          🏆 ชนะ {liveBot.wins}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 px-3 py-2 text-xs text-slate-500 flex items-center justify-between">
                      <span>📡 ไม่พบบอทชื่อ @{order.username} ในระบบ Telemetry</span>
                      <span className="text-[11px] text-slate-600">
                        (จะแสดงสถานะสดเมื่อเปิดบอท)
                      </span>
                    </div>
                  )}

                  {/* Action Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/5">
                    {/* Quick State Toggle Buttons */}
                    <div className="flex items-center gap-1.5">
                      {order.order_status !== "FARMING" && (
                        <button
                          type="button"
                          onClick={() => handleQuickStatusChange(order, "FARMING")}
                          className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20 transition"
                        >
                          🚀 เริ่มฟาร์ม
                        </button>
                      )}
                      {order.order_status !== "COMPLETED" && (
                        <button
                          type="button"
                          onClick={() =>
                            handleQuickStatusChange(order, "COMPLETED")
                          }
                          className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-200 hover:bg-emerald-500/20 transition"
                        >
                          ✅ เสร็จแล้ว
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Copy Chat Text Button */}
                      <button
                        type="button"
                        onClick={() => handleCopyCustomerChat(order)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-blue-400/40 bg-blue-500/15 px-3 py-1 text-xs font-bold text-blue-200 hover:bg-blue-500/25 transition shadow-sm"
                        title="คัดลอกข้อความสรุปสถานะและเพชรปัจจุบัน พร้อมส่งในแชทเฟสบุ๊คให้ลูกค้าทันที"
                      >
                        <span>📋</span>
                        <span>
                          {copiedId === order.id
                            ? "✓ คัดลอกแล้ว!"
                            : "สรุปส่งลูกค้า"}
                        </span>
                      </button>

                      {/* Edit Button */}
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(order)}
                        className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold text-slate-300 hover:bg-white/10 transition"
                      >
                        ✏️ แก้ไข
                      </button>

                      {/* Delete Button */}
                      <button
                        type="button"
                        onClick={() => handleDeleteOrder(order)}
                        className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-300 hover:bg-rose-500/20 transition"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ===================================================================
          MODAL: ADD / EDIT CUSTOMER ORDER
      =================================================================== */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-md">
          <div className="relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-cyan-500/40 bg-[#080816] shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <h3 className="text-lg font-extrabold text-white flex items-center gap-2">
                  <span>{editingOrder ? "✏️ แก้ไขข้อมูลลูกค้า" : "＋ เพิ่มออเดอร์ลูกค้าใหม่"}</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  กรอกชื่อเฟส Username และของที่ลูกค้าต้องการหา
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/10"
              >
                ✕ ปิด
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmitForm} className="overflow-y-auto p-6 space-y-4">
              {/* Facebook Name & Link */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-300">
                    ชื่อเฟสลูกค้า <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formFbName}
                    onChange={(e) => setFormFbName(e.target.value)}
                    placeholder="เช่น น้องโบ๊ท คนเดิม"
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-300">
                    ลิงก์โปรไฟล์เฟส (ถ้ามี)
                  </label>
                  <input
                    type="text"
                    value={formFbLink}
                    onChange={(e) => setFormFbLink(e.target.value)}
                    placeholder="https://facebook.com/..."
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Roblox Username & Target Item */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-300">
                    Roblox Username <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    placeholder="เช่น Player123"
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-cyan-200 font-mono placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-300">
                    ของที่หา / เป้าหมาย <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formTargetItem}
                    onChange={(e) => setFormTargetItem(e.target.value)}
                    placeholder="เช่น โกคู ซีเคร็ท, รีโรล 500, ฟาร์มเลเวล 100"
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Price & Paid Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-300">
                    ราคา / ยอดเงิน (บาท)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                    placeholder="เช่น 150"
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-amber-200 font-bold placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-300">
                    สถานะการชำระเงิน
                  </label>
                  <select
                    value={formPaidStatus}
                    onChange={(e) => setFormPaidStatus(e.target.value as PaymentStatus)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white focus:border-cyan-400 focus:outline-none"
                  >
                    <option value="UNPAID">🟡 ยังไม่โอน</option>
                    <option value="PAID">🟢 โอนแล้ว</option>
                    <option value="DEPOSIT">🟠 มัดจำแล้ว</option>
                  </select>
                </div>
              </div>

              {/* Order Status & Assigned Device */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-300">
                    สถานะงาน
                  </label>
                  <select
                    value={formOrderStatus}
                    onChange={(e) => setFormOrderStatus(e.target.value as OrderStatus)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white focus:border-cyan-400 focus:outline-none"
                  >
                    <option value="FARMING">🚀 กำลังฟาร์ม</option>
                    <option value="PENDING">⏳ รอดำเนินการ</option>
                    <option value="COMPLETED">✅ สำเร็จแล้ว</option>
                    <option value="CANCELLED">❌ ยกเลิก</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-300">
                    จอ / Emu ที่รับผิดชอบ
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={DEFAULT_EMU_OPTIONS.includes(formDevice) ? formDevice : "CUSTOM"}
                      onChange={(e) => {
                        if (e.target.value !== "CUSTOM") {
                          setFormDevice(e.target.value);
                        }
                      }}
                      className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-purple-200 font-bold focus:border-purple-400 focus:outline-none"
                    >
                      {DEFAULT_EMU_OPTIONS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                      <option value="CUSTOM">✏️ กำหนดเอง...</option>
                    </select>

                    <input
                      type="text"
                      value={formDevice}
                      onChange={(e) => setFormDevice(e.target.value)}
                      placeholder="ระบุชื่อจอ..."
                      className="flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-purple-200 font-bold placeholder-slate-500 focus:border-purple-400 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* 🔗 Finance 50/50 Linking Section */}
              <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-cyan-200 flex items-center gap-1.5">
                    <span>⚖️</span>
                    <span>ระบบบัญชีหาร 2 (พี 50% : บ๊วย 50%)</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formSyncFinance}
                      onChange={(e) => setFormSyncFinance(e.target.checked)}
                      className="rounded accent-cyan-400 h-4 w-4"
                    />
                    <span className="text-xs font-bold text-slate-300">
                      ลิ้งค์เข้าหน้าหาร 2 ทันที
                    </span>
                  </label>
                </div>

                {formSyncFinance && (
                  <div className="space-y-2 pt-1 border-t border-cyan-500/20">
                    <p className="text-[11px] text-slate-400">
                      ลูกค้าโอนเงินเข้าบัญชีใคร? (นำยอดเข้ากองกลางเพื่อหาร 2):
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFormPartner("B");
                          setFormHandledBy("บ๊วย");
                        }}
                        className={`rounded-xl p-2.5 text-xs font-bold border transition flex flex-col items-center gap-1 text-center ${
                          formPartner === "B"
                            ? "border-emerald-400 bg-emerald-500/20 text-emerald-200 shadow-md shadow-emerald-500/20"
                            : "border-white/10 bg-slate-950/60 text-slate-400 hover:bg-white/5"
                        }`}
                      >
                        <span className="text-sm">🟢 บ๊วย (คนรับโอนหลัก)</span>
                        <span className="text-[10px] text-slate-400">
                          เงินเข้าบ๊วย → หาร 2 บ๊วยโอนให้พี
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setFormPartner("A");
                          setFormHandledBy("พี");
                        }}
                        className={`rounded-xl p-2.5 text-xs font-bold border transition flex flex-col items-center gap-1 text-center ${
                          formPartner === "A"
                            ? "border-cyan-400 bg-cyan-500/20 text-cyan-200 shadow-md shadow-cyan-500/20"
                            : "border-white/10 bg-slate-950/60 text-slate-400 hover:bg-white/5"
                        }`}
                      >
                        <span className="text-sm">🔵 พี</span>
                        <span className="text-[10px] text-slate-400">
                          เงินเข้าพี → หาร 2 พีโอนให้บ๊วย
                        </span>
                      </button>
                    </div>

                    <div className="rounded-xl bg-slate-950/80 px-3 py-2 text-[11px] text-slate-400 space-y-0.5 border border-white/5">
                      <p className="font-semibold text-slate-300">
                        📌 ข้อมูลที่จะส่งไปหน้าคำนวณเงิน:
                      </p>
                      <p>
                        • <span className="text-amber-300 font-bold">จำนวนเงิน:</span> ฿{formPrice || "0"} บาท
                      </p>
                      <p>
                        • <span className="text-cyan-300 font-bold">ลูกค้า:</span> {formFbName || "(ชื่อเฟส)"} (@{formUsername || "(ชื่อในเกม)"})
                      </p>
                      <p>
                        • <span className="text-purple-300 font-bold">ทำอะไร:</span> {formTargetItem || "(ของที่หา)"}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Handled By & Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-300">
                    คนรับงาน / ผู้รับผิดชอบ
                  </label>
                  <input
                    type="text"
                    value={formHandledBy}
                    onChange={(e) => setFormHandledBy(e.target.value)}
                    placeholder="เช่น บ๊วย, พี"
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-300">
                    หมายเหตุเพิ่มเติม
                  </label>
                  <input
                    type="text"
                    value={formNote}
                    onChange={(e) => setFormNote(e.target.value)}
                    placeholder="เช่น โอนเงินเข้า บช. บ๊วยแล้ว"
                    className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-2 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs sm:text-sm font-bold text-slate-300 hover:bg-white/10"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingForm}
                  className="rounded-xl border border-cyan-400/50 bg-gradient-to-r from-cyan-500/30 to-blue-600/30 px-6 py-2 text-xs sm:text-sm font-bold text-cyan-100 hover:bg-cyan-500/40 transition disabled:opacity-50 shadow-lg shadow-cyan-500/20"
                >
                  {savingForm ? "กำลังบันทึก..." : editingOrder ? "บันทึกการแก้ไข" : "＋ เพิ่มลูกค้า"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
