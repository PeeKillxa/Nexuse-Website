"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TeamStrip from "@/app/components/TeamStrip";
import MatchHistoryModal from "@/app/components/MatchHistoryModal";
import type {
  BaselineStats,
  PortalSummary,
  TeamUnitInfo,
} from "@/app/lib/telemetry-types";

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
  duration_hours?: number;
  job_started_at?: number;
  job_end_at?: number;
  baseline_stats?: BaselineStats;
  created_at: number;
  updated_at: number;
}

export interface TelemetryBrief {
  user_id: number;
  username: string;
  display_name?: string;
  level: number;
  gems: number;
  gold?: number;
  april_coins: number;
  summer_pearls?: number;
  rerolls?: number;
  wins: number;
  disconnects: number;
  effective_status?: "ONLINE" | "OFFLINE";
  device_name?: string;
  game_name?: string;
  map_name?: string;
  map_difficulty?: string;
  wave?: string;
  team?: TeamUnitInfo[];
  portals?: PortalSummary[];
  extra_stats?: Record<string, number | string | boolean>;
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
  "PC-1",
  "PC-2",
  "PC-3",
  "Notebook",
];

const DURATION_PRESETS = [
  { label: "ไม่กำหนด", days: 0, hours: 0 },
  { label: "1 วัน", days: 1, hours: 0 },
  { label: "2 วัน", days: 2, hours: 0 },
  { label: "3 วัน", days: 3, hours: 0 },
  { label: "5 วัน", days: 5, hours: 0 },
  { label: "7 วัน", days: 7, hours: 0 },
];

function sanitizeDeviceName(device?: string): string {
  const clean = (device || "").trim();
  if (!clean || clean.toLowerCase().startsWith("android")) return "PC";
  return clean;
}

function formatRemainingCountdown(remainSec: number): string {
  const safe = Math.max(0, Math.floor(remainSec));
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  if (days > 0) {
    return `${days} วัน ${pad2(hours)} ชม. ${pad2(mins)} นาที ${pad2(secs)} วินาที`;
  }
  return `${pad2(hours)} ชม. ${pad2(mins)} นาที ${pad2(secs)} วินาที`;
}

function buildBaselineFromBot(bot: TelemetryBrief): BaselineStats {
  return {
    gems: Number(bot.gems || 0),
    gold: Number(bot.gold || 0),
    summer_pearls: Number(bot.summer_pearls ?? bot.april_coins ?? 0),
    rerolls: Number(bot.rerolls ?? bot.extra_stats?.rerolls ?? 0),
    level: Number(bot.level || 1),
    wins: Number(bot.wins || 0),
    captured_at: Math.floor(Date.now() / 1000),
  };
}

function formatSignedDelta(delta: number): string {
  const n = Math.round(delta);
  if (n > 0) return `+${n.toLocaleString("en-US")}`;
  return n.toLocaleString("en-US");
}

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
  const [matchLogCounts, setMatchLogCounts] = useState<Record<string, number>>({});
  const [matchLogTotal, setMatchLogTotal] = useState<number>(0);
  const [showMatchHistory, setShowMatchHistory] = useState<boolean>(false);
  const [matchHistoryUsername, setMatchHistoryUsername] = useState<string>("");

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("FARMING");
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
  const [formDevice, setFormDevice] = useState<string>("PC");
  const [formHandledBy, setFormHandledBy] = useState<string>("บ๊วย");
  const [formPartner, setFormPartner] = useState<"A" | "B">("B");
  const [formSyncFinance, setFormSyncFinance] = useState<boolean>(true);
  const [formNote, setFormNote] = useState<string>("");
  const [formDurationDays, setFormDurationDays] = useState<string>("");
  const [formDurationHours, setFormDurationHours] = useState<string>("");
  const [formRestartTimer, setFormRestartTimer] = useState<boolean>(false);
  const [formResetBaseline, setFormResetBaseline] = useState<boolean>(false);
  const [savingForm, setSavingForm] = useState<boolean>(false);
  const [nowTick, setNowTick] = useState<number>(() => Math.floor(Date.now() / 1000));
  const autoBaselineAttemptedRef = React.useRef<Set<string>>(new Set());

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

  const loadMatchLogCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/match-logs", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          ok: boolean;
          total_count?: number;
          counts_by_user?: Record<string, number>;
        };
        if (data.ok) {
          setMatchLogTotal(data.total_count || 0);
          setMatchLogCounts(data.counts_by_user || {});
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Fetch telemetry to cross-reference customer usernames with online farm bots
  const loadTelemetry = useCallback(async () => {
    loadMatchLogCounts();
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
  }, [loadMatchLogCounts]);

  useEffect(() => {
    loadOrders();
    loadTelemetry();
    const telemetryTimer = setInterval(() => {
      loadTelemetry();
    }, 12000);
    const ordersTimer = setInterval(() => {
      loadOrders();
    }, 30000);
    const countdownTimer = setInterval(() => {
      setNowTick(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => {
      clearInterval(telemetryTimer);
      clearInterval(ordersTimer);
      clearInterval(countdownTimer);
    };
  }, [loadOrders, loadTelemetry]);

  // Auto-capture initial baseline stats when a FARMING order has live telemetry but no baseline yet
  useEffect(() => {
    const candidates = orders.filter((order) => {
      if (order.order_status !== "FARMING") return false;
      if (order.baseline_stats) return false;
      if (autoBaselineAttemptedRef.current.has(order.id)) return false;
      const bot = liveBots[order.username.toLowerCase()];
      return Boolean(bot);
    });
    if (candidates.length === 0) return;

    for (const order of candidates) {
      const bot = liveBots[order.username.toLowerCase()];
      if (!bot) continue;
      autoBaselineAttemptedRef.current.add(order.id);
      const snapshot = buildBaselineFromBot(bot);
      fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_customer",
          id: order.id,
          baseline_stats: snapshot,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.ok && Array.isArray(data.orders)) {
            setOrders(data.orders);
            persistLocal(data.orders);
          }
        })
        .catch(() => {
          // ignore
        });
    }
  }, [orders, liveBots, persistLocal]);

  const handleSyncOrdersNow = async () => {
    setSyncingOrders(true);
    try {
      await loadOrders();
    } finally {
      setSyncingOrders(false);
    }
  };

  // Open Add Modal
  const handleOpenAddModal = (initialUsername = "", initialDevice = "PC") => {
    setEditingOrder(null);
    setFormFbName("");
    setFormFbLink("");
    setFormUsername(initialUsername);
    setFormTargetItem("");
    setFormPrice("");
    setFormPaidStatus("UNPAID");
    setFormOrderStatus("FARMING");
    setFormDevice(sanitizeDeviceName(initialDevice));
    setFormPartner("B");
    setFormSyncFinance(true);
    setFormHandledBy("บ๊วย");
    setFormNote("");
    setFormDurationDays("");
    setFormDurationHours("");
    setFormRestartTimer(false);
    setFormResetBaseline(false);
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
    setFormDevice(sanitizeDeviceName(order.assigned_device));
    setFormPartner(order.finance_partner || "B");
    setFormSyncFinance(Boolean(order.finance_tx_id) || true);
    setFormHandledBy(order.handled_by || (order.finance_partner === "A" ? "พี" : "บ๊วย"));
    setFormNote(order.note || "");
    const totalHours = Number(order.duration_hours || 0);
    if (totalHours > 0) {
      const wholeDays = Math.floor(totalHours / 24);
      const remHours = Math.round((totalHours % 24) * 10) / 10;
      setFormDurationDays(wholeDays > 0 ? String(wholeDays) : "");
      setFormDurationHours(remHours > 0 ? String(remHours) : "");
    } else {
      setFormDurationDays("");
      setFormDurationHours("");
    }
    setFormRestartTimer(false);
    setFormResetBaseline(false);
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
      const daysNum = Math.max(0, Number(formDurationDays || 0));
      const hoursNum = Math.max(0, Number(formDurationHours || 0));
      const totalDurationHours = Math.round((daysNum * 24 + hoursNum) * 100) / 100;
      const matchedBot = liveBots[formUsername.trim().toLowerCase()];

      const payload: Record<string, unknown> = {
        action,
        facebook_name: formFbName.trim(),
        facebook_link: formFbLink.trim(),
        username: formUsername.trim(),
        target_item: formTargetItem.trim(),
        price: formPrice ? Number(formPrice) : 0,
        paid_status: formPaidStatus,
        order_status: formOrderStatus,
        assigned_device: sanitizeDeviceName(formDevice),
        handled_by: formHandledBy.trim() || (formPartner === "B" ? "บ๊วย" : "พี"),
        finance_partner: formPartner,
        sync_to_finance: formSyncFinance,
        note: formNote.trim(),
        duration_hours: totalDurationHours,
      };

      if (isEdit && editingOrder) {
        payload.id = editingOrder.id;
        if (formRestartTimer) {
          payload.restart_timer = true;
        }
        if (formResetBaseline && matchedBot) {
          payload.baseline_stats = buildBaselineFromBot(matchedBot);
        }
      } else if (matchedBot) {
        payload.baseline_stats = buildBaselineFromBot(matchedBot);
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

  // Delete Order (also auto-cleans webhook match history for finished job)
  const handleDeleteOrder = async (order: CustomerOrder) => {
    if (
      !confirm(
        `ต้องการลบรายการของ "${order.facebook_name}" (@${order.username}) และล้างประวัติจบด่านของไอดีนี้ ใช่หรือไม่?`
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
        if (order.username) {
          fetch(`/api/match-logs?username=${encodeURIComponent(order.username)}`, {
            method: "DELETE",
          })
            .then(() => loadMatchLogCounts())
            .catch(() => {});
        }
        showToast(`🗑️ ลบข้อมูลของ ${order.facebook_name} และประวัติแมพเรียบร้อย`);
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

  const handleResetOrderBaseline = async (
    order: CustomerOrder,
    bot: TelemetryBrief
  ) => {
    try {
      const snapshot = buildBaselineFromBot(bot);
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_customer",
          id: order.id,
          baseline_stats: snapshot,
        }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.orders)) {
        setOrders(data.orders);
        persistLocal(data.orders);
        showToast(`📸 รีเซ็ตจุดเริ่มต้นของ @${order.username} เป็นค่าล่าสุดแล้ว`);
      }
    } catch {
      showToast("❌ รีเซ็ตจุดเริ่มต้นไม่สำเร็จ");
    }
  };

  const handleQuickSetDuration = async (
    order: CustomerOrder,
    durationHours: number
  ) => {
    try {
      const bot = liveBots[order.username.toLowerCase()];
      const payload: Record<string, unknown> = {
        action: "update_customer",
        id: order.id,
        duration_hours: durationHours,
        restart_timer: true,
      };
      if (!order.baseline_stats && bot) {
        payload.baseline_stats = buildBaselineFromBot(bot);
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
        const daysText =
          durationHours % 24 === 0
            ? `${durationHours / 24} วัน`
            : `${durationHours} ชม.`;
        showToast(`⏱️ เริ่มจับเวลา ${daysText} ให้ @${order.username} แล้ว`);
      }
    } catch {
      showToast("❌ ตั้งเวลาไม่สำเร็จ");
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

    if (order.job_end_at && order.job_started_at) {
      const remain = Math.max(0, order.job_end_at - nowTick);
      const total = Math.max(1, order.job_end_at - order.job_started_at);
      const pct = Math.min(100, Math.max(0, Math.round(((nowTick - order.job_started_at) / total) * 100)));
      if (remain <= 0) {
        text += `⏱️ ระยะเวลางาน: ✅ ครบกำหนดเวลาแล้ว (${pct}%)\n`;
      } else {
        text += `⏱️ ความคืบหน้า: ${pct}% | เหลืออีก ${formatRemainingCountdown(remain)}\n`;
      }
    }

    if (liveBot) {
      const liveMap =
        liveBot.map_name ||
        (liveBot.extra_stats?.map_name as string) ||
        liveBot.game_name ||
        "Anime Adventures";
      const liveWave =
        liveBot.wave || (liveBot.extra_stats?.wave as string) || "";
      text += `🗺️ แมพปัจจุบัน: ${liveMap}${liveWave ? ` (${liveWave})` : ""}\n`;
      text += `💎 เพชรปัจจุบันในตัว: ${formatNumber(liveBot.gems)} Gems\n`;
      text += `⭐ เลเวลปัจจุบัน: Lv.${liveBot.level}\n`;
      const pearls = liveBot.summer_pearls ?? liveBot.april_coins ?? 0;
      if (pearls > 0) {
        text += `☀️ Summer Coin: ${formatNumber(pearls)}\n`;
      }
      text += `🏆 ชนะด่านสะสม: ${liveBot.wins} รอบ\n`;

      if (order.baseline_stats) {
        const base = order.baseline_stats;
        const dGems = Number(liveBot.gems || 0) - Number(base.gems || 0);
        const dPearls = Number(pearls) - Number(base.summer_pearls || 0);
        const dGold = Number(liveBot.gold || 0) - Number(base.gold || 0);
        const dRerolls =
          Number(liveBot.rerolls ?? liveBot.extra_stats?.rerolls ?? 0) -
          Number(base.rerolls || 0);
        const dWins = Number(liveBot.wins || 0) - Number(base.wins || 0);
        const gainParts: string[] = [];
        if (dPearls !== 0) gainParts.push(`${formatSignedDelta(dPearls)} Pearls`);
        if (dGems !== 0) gainParts.push(`${formatSignedDelta(dGems)} Gems`);
        if (dGold !== 0) gainParts.push(`${formatSignedDelta(dGold)} Gold`);
        if (dRerolls !== 0) gainParts.push(`${formatSignedDelta(dRerolls)} Rerolls`);
        if (dWins !== 0) gainParts.push(`${formatSignedDelta(dWins)} Wins`);
        if (gainParts.length > 0) {
          text += `📈 ได้เพิ่มระหว่างฟาร์ม: ${gainParts.join(" | ")}\n`;
        }
      }

      text += `🟢 สถานะในเกม: ออนไลน์ฟาร์มอยู่ (จอ ${sanitizeDeviceName(order.assigned_device || liveBot.device_name)})\n`;
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
              onClick={() => {
                setMatchHistoryUsername("");
                setShowMatchHistory(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-indigo-400/35 bg-indigo-500/15 px-3.5 py-2.5 text-xs font-bold text-indigo-200 transition hover:bg-indigo-500/25"
            >
              <span>📜</span>
              <span>ประวัติจบด่าน ({matchLogTotal})</span>
            </button>

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
                          {/* Device Badge */}
                          <span className="inline-flex items-center gap-1 rounded-md border border-purple-400/35 bg-purple-500/15 px-2 py-0.5 text-[11px] font-bold text-purple-200">
                            <span>💻</span>
                            <span>{sanitizeDeviceName(order.assigned_device)}</span>
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

                  {/* ⏱️ Job Progress Bar & Real-Time Countdown */}
                  {order.job_end_at && order.job_started_at ? (
                    (() => {
                      const totalSec = Math.max(
                        1,
                        order.job_end_at - order.job_started_at
                      );
                      const remainSec = Math.max(0, order.job_end_at - nowTick);
                      const elapsedSec = Math.min(
                        totalSec,
                        Math.max(0, nowTick - order.job_started_at)
                      );
                      const pct = Math.min(
                        100,
                        Math.max(0, Math.round((elapsedSec / totalSec) * 1000) / 10)
                      );
                      const isTimeUp = remainSec <= 0;
                      const durDays = Math.floor((order.duration_hours || 0) / 24);
                      const durRemH = Math.round(((order.duration_hours || 0) % 24) * 10) / 10;
                      const durLabel =
                        durDays > 0 && durRemH > 0
                          ? `${durDays} วัน ${durRemH} ชม.`
                          : durDays > 0
                          ? `${durDays} วัน`
                          : `${order.duration_hours || 0} ชม.`;

                      return (
                        <div
                          className={`rounded-2xl border p-3 space-y-2 ${
                            isTimeUp
                              ? "border-emerald-400/40 bg-emerald-950/20"
                              : "border-amber-400/30 bg-amber-950/15"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-bold text-amber-200 flex items-center gap-1.5">
                              <span>⏱️ ความคืบหน้างาน ({durLabel})</span>
                            </span>
                            <span
                              className={`font-mono font-extrabold ${
                                isTimeUp ? "text-emerald-300" : "text-amber-300"
                              }`}
                            >
                              {isTimeUp
                                ? "✅ ครบกำหนดเวลาแล้ว (100%)"
                                : `เหลืออีก ${formatRemainingCountdown(remainSec)} (${pct}%)`}
                            </span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-900/90 border border-white/10">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                isTimeUp
                                  ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                                  : "bg-gradient-to-r from-amber-500 via-orange-400 to-cyan-400"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                            <span>เริ่ม: {formatThaiDate(order.job_started_at)}</span>
                            <span>ครบกำหนด: {formatThaiDate(order.job_end_at)}</span>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    order.order_status !== "COMPLETED" && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-[11px]">
                        <span className="text-slate-400">⏱️ ยังไม่ได้ตั้งเวลาจ้าง:</span>
                        <div className="flex items-center gap-1.5">
                          {[24, 72, 168].map((hrs) => (
                            <button
                              key={hrs}
                              type="button"
                              onClick={() => handleQuickSetDuration(order, hrs)}
                              className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 font-bold text-amber-200 hover:bg-amber-500/25 transition"
                            >
                              + ตั้ง {hrs / 24} วัน
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  )}

                  {/* ⚡ Live Farm Telemetry Bridge Box */}
                  {liveBot ? (
                    <div className="space-y-2.5">
                      <div
                        className={`rounded-2xl border p-3 space-y-2 ${
                          isOnline
                            ? "border-emerald-500/35 bg-emerald-950/20 text-emerald-200"
                            : "border-rose-500/35 bg-rose-950/20 text-rose-200"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
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
                              ({sanitizeDeviceName(liveBot.device_name || order.assigned_device)})
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2.5 text-xs font-bold">
                            <span className="text-cyan-300">
                              💎 {formatNumber(liveBot.gems)}
                            </span>
                            {((liveBot.summer_pearls ?? liveBot.april_coins) || 0) > 0 && (
                              <span className="text-amber-300">
                                🦪 {formatNumber(liveBot.summer_pearls ?? liveBot.april_coins)}
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

                        {/* Live Map & Wave */}
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/65 px-2.5 py-1.5 text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-slate-400 shrink-0">🗺️ แมพ:</span>
                            <span className="font-extrabold text-cyan-200 truncate">
                              {liveBot.map_name ||
                                (liveBot.extra_stats?.map_name as string) ||
                                liveBot.game_name ||
                                "Anime Adventures"}
                            </span>
                            {liveBot.map_difficulty && (
                              <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] font-bold text-amber-200 shrink-0">
                                {liveBot.map_difficulty}
                              </span>
                            )}
                          </div>
                          <span className="rounded-md border border-cyan-400/30 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-bold text-cyan-200 shrink-0">
                            {String(liveBot.wave || liveBot.extra_stats?.wave || "Lobby")}
                          </span>
                        </div>
                      </div>

                      {/* Equipped Team Strip */}
                      <TeamStrip team={liveBot.team} compact />

                      {/* 📈 Net Gains Comparison Since Start (Excluding Baseline) */}
                      {order.baseline_stats ? (
                        (() => {
                          const base = order.baseline_stats;
                          const curPearls = Number(
                            liveBot.summer_pearls ?? liveBot.april_coins ?? 0
                          );
                          const curRerolls = Number(
                            liveBot.rerolls ?? liveBot.extra_stats?.rerolls ?? 0
                          );
                          const metrics = [
                            {
                              label: "🦪 Pearls",
                              start: Number(base.summer_pearls || 0),
                              now: curPearls,
                              color: "text-amber-300",
                            },
                            {
                              label: "💎 Gems",
                              start: Number(base.gems || 0),
                              now: Number(liveBot.gems || 0),
                              color: "text-cyan-300",
                            },
                            {
                              label: "🪙 Gold",
                              start: Number(base.gold || 0),
                              now: Number(liveBot.gold || 0),
                              color: "text-yellow-300",
                            },
                            {
                              label: "🎲 Rerolls",
                              start: Number(base.rerolls || 0),
                              now: curRerolls,
                              color: "text-fuchsia-300",
                            },
                            {
                              label: "🏆 Wins",
                              start: Number(base.wins || 0),
                              now: Number(liveBot.wins || 0),
                              color: "text-emerald-300",
                            },
                            {
                              label: "⭐ Lv",
                              start: Number(base.level || 1),
                              now: Number(liveBot.level || 1),
                              color: "text-purple-300",
                            },
                          ];
                          return (
                            <div className="rounded-2xl border border-cyan-400/25 bg-slate-950/75 p-3 space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                <span className="font-bold text-cyan-200">
                                  📈 ได้เพิ่มระหว่างทำงาน (ไม่รวมตอนเริ่ม)
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-slate-400">
                                    จุดเริ่ม: {formatThaiDate(base.captured_at)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleResetOrderBaseline(order, liveBot)}
                                    className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-slate-300 hover:bg-white/15 transition"
                                    title="รีเซ็ตจุดเริ่มต้นเป็นค่าตอนนี้"
                                  >
                                    🔄 รีจุดเริ่ม
                                  </button>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                                {metrics.map((m) => {
                                  const delta = m.now - m.start;
                                  return (
                                    <div
                                      key={m.label}
                                      className="rounded-xl border border-white/10 bg-slate-900/80 px-2.5 py-1.5"
                                    >
                                      <div className="flex items-center justify-between gap-1 text-[11px]">
                                        <span className="text-slate-400">{m.label}</span>
                                        <span
                                          className={`font-mono font-extrabold ${
                                            delta > 0
                                              ? "text-emerald-300"
                                              : delta < 0
                                              ? "text-rose-300"
                                              : "text-slate-400"
                                          }`}
                                        >
                                          {formatSignedDelta(delta)}
                                        </span>
                                      </div>
                                      <div className="text-[10px] font-mono text-slate-500 mt-0.5 truncate">
                                        {formatCompact(m.start)} →{" "}
                                        <span className={m.color}>{formatCompact(m.now)}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/50 px-3 py-1.5 text-[11px]">
                          <span className="text-slate-400">📸 ยังไม่มีจุดเริ่มต้นเทียบยอด</span>
                          <button
                            type="button"
                            onClick={() => handleResetOrderBaseline(order, liveBot)}
                            className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 font-bold text-cyan-200 hover:bg-cyan-500/25 transition"
                          >
                            บันทึกค่าเริ่มต้นตอนนี้
                          </button>
                        </div>
                      )}
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

                    <div className="flex flex-wrap items-center gap-2">
                      {/* Match Webhook History Button */}
                      <button
                        type="button"
                        onClick={() => {
                          setMatchHistoryUsername(order.username || "");
                          setShowMatchHistory(true);
                        }}
                        className="inline-flex items-center gap-1 rounded-xl border border-indigo-400/40 bg-indigo-500/15 px-2.5 py-1 text-xs font-bold text-indigo-200 hover:bg-indigo-500/25 transition"
                        title="ดูประวัติจบด่าน Webhook ของลูกค้าคนนี้"
                      >
                        <span>📜</span>
                        <span>
                          ผลแมพ ({matchLogCounts[(order.username || "").toLowerCase()] || 0})
                        </span>
                      </button>
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
                      placeholder="ระบุชื่อเครื่อง..."
                      className="flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-purple-200 font-bold placeholder-slate-500 focus:border-purple-400 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* ⏱️ Job Duration & Progress Timer + Gain Baseline */}
              <div className="rounded-2xl border border-amber-400/25 bg-amber-950/15 p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-black text-amber-200 flex items-center gap-1.5">
                    <span>⏱️</span>
                    <span>ระยะเวลาจ้าง & แถบความคืบหน้า (Countdown)</span>
                  </label>
                  <div className="flex flex-wrap items-center gap-1">
                    {DURATION_PRESETS.map((preset) => {
                      const isActive =
                        Number(formDurationDays || 0) === preset.days &&
                        Number(formDurationHours || 0) === preset.hours;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setFormDurationDays(preset.days > 0 ? String(preset.days) : "");
                            setFormDurationHours(preset.hours > 0 ? String(preset.hours) : "");
                          }}
                          className={`rounded-lg px-2 py-1 text-[11px] font-bold border transition ${
                            isActive
                              ? "border-amber-400 bg-amber-500/25 text-amber-200"
                              : "border-white/10 bg-slate-950/70 text-slate-400 hover:text-white"
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-slate-300">
                      จำนวนวัน (Days)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={formDurationDays}
                      onChange={(e) => setFormDurationDays(e.target.value)}
                      placeholder="เช่น 3"
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-1.5 text-xs sm:text-sm text-amber-200 font-bold placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-slate-300">
                      ชั่วโมงเพิ่มเติม (Hours)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="23"
                      step="0.5"
                      value={formDurationHours}
                      onChange={(e) => setFormDurationHours(e.target.value)}
                      placeholder="เช่น 0"
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-1.5 text-xs sm:text-sm text-amber-200 font-bold placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                </div>

                {editingOrder && (
                  <div className="flex flex-col gap-1.5 pt-1 border-t border-amber-400/15 text-[11px]">
                    <label className="inline-flex items-center gap-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={formRestartTimer}
                        onChange={(e) => setFormRestartTimer(e.target.checked)}
                        className="rounded accent-amber-400 h-3.5 w-3.5"
                      />
                      <span>รีเซ็ตเวลานับถอยหลังใหม่เริ่มตั้งแต่ตอนนี้</span>
                    </label>
                    {liveBots[formUsername.trim().toLowerCase()] && (
                      <label className="inline-flex items-center gap-2 cursor-pointer text-slate-300">
                        <input
                          type="checkbox"
                          checked={formResetBaseline}
                          onChange={(e) => setFormResetBaseline(e.target.checked)}
                          className="rounded accent-cyan-400 h-3.5 w-3.5"
                        />
                        <span>รีเซ็ตจุดเริ่มต้น (Baseline) เป็นค่าปัจจุบันของบอทตอนนี้</span>
                      </label>
                    )}
                  </div>
                )}
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
      <MatchHistoryModal
        isOpen={showMatchHistory}
        onClose={() => setShowMatchHistory(false)}
        initialUsername={matchHistoryUsername}
        onLogsChanged={loadMatchLogCounts}
      />
    </div>
  );
}
