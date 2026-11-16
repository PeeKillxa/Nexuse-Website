-- ============================================================
-- 🤖 ROBLOX MULTI-ACCOUNT FARM TELEMETRY SENDER (v2.6)
-- Optimized for: Anime Adventures (Lobby + Story/Match) & All Games
-- Author: cook45 for clack (Tuned for nexuse-website.vercel.app & Rokid Watchdog v3.0)
-- วางสคริปต์นี้ใน Auto-Execute ของ Executor ทุกจอ
-- ============================================================

-- ป้องกันการรันซ้ำซ้อนในแมพเดิม (ถ้ามีสคริปต์เรียกซ้ำ จะยกเลิกลูปเก่าอัตโนมัติ)
local env = (getgenv and getgenv()) or _G
local CURRENT_RUN_ID = tostring(os.clock()) .. "_" .. tostring(math.random(100000, 999999))
env._COOK45_TRACKER_RUN_ID = CURRENT_RUN_ID

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local Stats = game:GetService("Stats")
local MarketplaceService = game:GetService("MarketplaceService")
local RunService = game:GetService("RunService")
local VirtualUser = game:GetService("VirtualUser")
local GuiService = game:GetService("GuiService")
local TeleportService = game:GetService("TeleportService")

local API_URL = "https://nexuse-website.vercel.app/api/telemetry"
local MATCH_LOG_API_URL = "https://nexuse-website.vercel.app/api/match-logs"
local SEND_INTERVAL = 15 -- ส่งข้อมูลทุกๆ 15 วินาที
local AA_LOBBY_PLACE_ID = 8304191830
local AA_UNIVERSE_ID = 3183403065
local pcConfigFile = "nexus_autorejoin_config.json"
local isFileSystemSupported = (writefile and readfile and isfile) and true or false

local function stripUtf8Bom(s)
    if type(s) ~= "string" then return "" end
    return (s:gsub("^\239\187\191", ""))
end

local function getAutoRejoinConfig()
    local cfg = { enabled = true, place_id = AA_LOBBY_PLACE_ID, ui_timeout_sec = 90 }
    if isFileSystemSupported then
        pcall(function()
            if isfile(pcConfigFile) then
                local raw = stripUtf8Bom(readfile(pcConfigFile))
                local parsed = HttpService:JSONDecode(raw)
                if type(parsed) == "table" then
                    if parsed.enabled ~= nil then cfg.enabled = (parsed.enabled == true) end
                    if tonumber(parsed.place_id) and tonumber(parsed.place_id) > 0 then
                        cfg.place_id = tonumber(parsed.place_id)
                    end
                    if tonumber(parsed.ui_timeout_sec) and tonumber(parsed.ui_timeout_sec) >= 45 then
                        cfg.ui_timeout_sec = tonumber(parsed.ui_timeout_sec)
                    end
                end
            end
        end)
    end
    return cfg
end

-- ============================================================
-- 🚨 EARLY PRE-LOAD GUARD (ดักจับ Error Code 256 / 524 / 277 ตั้งแต่ก่อนแมพโหลดเสร็จ!)
-- ป้องกันปัญหาค้างที่ game.Loaded:Wait() ตอนวาร์ปย้ายด่านแล้วเซิร์ฟตัดการเชื่อมต่อกลางทาง
-- ============================================================
local earlyRejoinTriggered = false
local function triggerEarlyDisconnectKill(reasonStr)
    if earlyRejoinTriggered then return end
    local cfg = getAutoRejoinConfig()
    if not cfg.enabled then return end
    earlyRejoinTriggered = true
    warn(string.format("[EarlyDisconnectGuard] 🚨 (%s) Detected disconnect before map load! Closing Roblox so Real restarts it...", tostring(reasonStr)))
    pcall(function()
        if writefile then
            writefile("watchdog_disconnected.txt", tostring(reasonStr) .. "\n")
        end
    end)
    task.spawn(function()
        task.wait(1.5)
        pcall(function() game:Shutdown() end)
    end)
end

-- รอ game:IsLoaded() และ LocalPlayer แบบไม่บล็อกตาย (เช็ค Error 256/524 ทุก 0.5 วินาทีระหว่างโหลด)
local loadWaitStart = os.clock()
while (not game:IsLoaded() or not Players.LocalPlayer) and (os.clock() - loadWaitStart) < 35 do
    local errVal = 0
    pcall(function() errVal = GuiService:GetErrorCode().Value end)
    if errVal == 524 or (errVal >= 256 and errVal ~= 285) then
        triggerEarlyDisconnectKill("ErrorCode during load: " .. tostring(errVal))
        break
    end
    task.wait(0.5)
end

if not Players.LocalPlayer and (os.clock() - loadWaitStart) >= 35 then
    triggerEarlyDisconnectKill("LocalPlayer/Map load timeout > 35s")
end

local httpRequest = (syn and syn.request) or (http and http.request) or http_request or (fluxus and fluxus.request) or request
if not httpRequest then
    warn("[FarmDashboard] ❌ Executor ของคุณไม่รองรับคำสั่ง http_request / request")
    return
end

local player = Players.LocalPlayer or Players.PlayerAdded:Wait()

-- ============================================================
-- 🛡️ BULLETPROOF ANTI-AFK ENGINE (ป้องกันการโดนเตะ AFK 20 นาที 100%)
-- ============================================================
pcall(function()
    player.Idled:Connect(function()
        pcall(function()
            VirtualUser:CaptureController()
            VirtualUser:ClickButton2(Vector2.new(0, 0))
        end)
    end)
end)

-- ส่งคลิกเสมือนทุกๆ 3 นาทีเพื่อรีเซ็ต Idle Timer ต่อเนื่อง
task.spawn(function()
    while task.wait(180) do
        pcall(function()
            VirtualUser:CaptureController()
            VirtualUser:ClickButton2(Vector2.new(0, 0))
        end)
    end
end)

-- ============================================================
-- ⏱️ PERSISTENT BOT SESSION & WATCHDOG HEARTBEAT ENGINE
-- ============================================================
local sessionFile = string.format("bot_session_%s.json", tostring(player.UserId))
local heartbeatFile = "watchdog_heartbeat.txt"
local animeUIStatusFile = "watchdog_ui_status.txt"
local rokidCheckFile = string.format("executor_check_%s.txt", tostring(player.Name))
local pcHeartbeatFile = string.format("watchdog_hb_%s.json", tostring(player.UserId))
local pcDisconnectFile = string.format("watchdog_dc_%s.txt", tostring(player.UserId))
local pcCmdByUidFile = string.format("watchdog_cmd_%s.txt", tostring(player.UserId))
local pcCmdByNameFile = string.format("watchdog_cmd_%s.txt", tostring(player.Name))
local isKickedOrDisconnected = false
local isTeleportingFlag = false
local teleportStartedAt = 0
local isInGameRejoining = false
local disconnectReason = ""
local disconnectErrorCode = 0
local scriptLoadedAt = os.time()

local function startInGameTeleportLoop(customPlaceId, reasonLabel)
    if isInGameRejoining then return end
    isInGameRejoining = true
    isTeleportingFlag = true
    local cfg = getAutoRejoinConfig()
    local targetPlaceId = tonumber(customPlaceId)
    if not targetPlaceId or targetPlaceId <= 0 then
        -- บังคับกลับเข้า Lobby หลัก (8304191830) เสมอ เพื่อป้องกันการวาร์ปเข้า Sub-Place ด่าน (14229839966 / 14918509670 / 8349889591) แล้วติด Error Code 524 ซ้ำ!
        targetPlaceId = (cfg.place_id and cfg.place_id > 0) and cfg.place_id or AA_LOBBY_PLACE_ID
    end

    warn(string.format("[InGameRejoin] 🔄 (%s) Leaving map & rejoining PlaceId %d inside current Roblox window...", tostring(reasonLabel or "AutoRejoin"), targetPlaceId))

    pcall(function()
        if writefile then
            writefile(pcHeartbeatFile, HttpService:JSONEncode({
                user_id = player.UserId,
                username = player.Name,
                place_id = game.PlaceId,
                game_id = tostring(game.GameId),
                job_id = tostring(game.JobId or ""),
                last_seen = os.time(),
                ui_exists = false,
                ui_enabled = false,
                teleporting = true,
                disconnected = isKickedOrDisconnected,
                disconnect_code = disconnectErrorCode,
                disconnect_reason = tostring(reasonLabel or disconnectReason or "Rejoining in-game")
            }) .. "\n")
        end
    end)

    task.spawn(function()
        local attempt = 0
        while env._COOK45_TRACKER_RUN_ID == CURRENT_RUN_ID do
            attempt = attempt + 1
            pcall(function() GuiService:ClearError() end)
            pcall(function()
                TeleportService:Teleport(targetPlaceId, player)
            end)
            task.wait(6)
        end
    end)
end

-- ล้างไฟล์แจ้งเตือนหลุดค้างเก่าทันทีเมื่อสคริปต์โหลดเข้าแมพสำเร็จ
pcall(function()
    if delfile and isfile then
        if isfile("watchdog_disconnected.txt") then delfile("watchdog_disconnected.txt") end
        if isfile(pcDisconnectFile) then delfile(pcDisconnectFile) end
        if isfile(pcCmdByUidFile) then delfile(pcCmdByUidFile) end
        if isfile(pcCmdByNameFile) then delfile(pcCmdByNameFile) end
    end
end)

-- ดักจับการวาร์ปย้ายแมพ (Lobby <-> Match / Replay) เพื่อส่งสัญญาณให้ Watchdog ขยายเวลาโหลด
pcall(function()
    player.OnTeleport:Connect(function(teleportState)
        pcall(function()
            if teleportState == Enum.TeleportState.Failed then
                isTeleportingFlag = false
                return
            end
            isTeleportingFlag = true
            teleportStartedAt = os.time()
            if writefile then
                local nowEpoch = os.time()
                local nowStr = tostring(nowEpoch) .. "\n"
                writefile(heartbeatFile, nowStr)
                writefile(rokidCheckFile, "working:" .. tostring(nowEpoch))
                writefile(pcHeartbeatFile, HttpService:JSONEncode({
                    user_id = player.UserId,
                    username = player.Name,
                    place_id = game.PlaceId,
                    game_id = tostring(game.GameId),
                    job_id = tostring(game.JobId or ""),
                    last_seen = nowEpoch,
                    ui_exists = true,
                    ui_enabled = true,
                    teleporting = true,
                    disconnected = false,
                    disconnect_code = 0,
                    disconnect_reason = ""
                }) .. "\n")
            end
            if delfile and isfile then
                if isfile("watchdog_disconnected.txt") then delfile("watchdog_disconnected.txt") end
                if isfile(pcDisconnectFile) then delfile(pcDisconnectFile) end
            end
        end)
    end)
end)

-- อ่านข้อมูล Session เดิมจากเครื่อง (ถ้ามี)
-- หากสคริปต์เพิ่งถูกรันใหม่จากการ Replay, ย้ายแมพ, หรือเซิร์ฟรี ภายใน 10 นาที (600 วิ)
-- จะนับเวลา Uptime ต่อเนื่องจาก Session เดิมทันที ไม่รีเซ็ตเป็น 0!
local sessionStartTime = os.time()
local sessionWins = 0
local sessionDisconnects = 0
local cached_april_coins = 0
local cached_summer_pearls = 0
local isFileSystemSupported = (writefile and readfile and isfile) and true or false
local sendTelemetry -- forward declaration

if isFileSystemSupported then
    pcall(function()
        if isfile(sessionFile) then
            local content = readfile(sessionFile)
            local data = HttpService:JSONDecode(content)
            if data and data.last_seen then
                local timeSinceLast = os.time() - data.last_seen
                -- ถ้าห่างจากรอบล่าสุดไม่เกิน 600 วินาที (10 นาที) ให้นับ Uptime ต่อเนื่อง
                if data.session_start and timeSinceLast >= 0 and timeSinceLast < 600 then
                    sessionStartTime = data.session_start
                end
                -- เก็บสถิติชนะ (Wins), หลุด (Disconnects), และ AprilCoins ต่อเนื่องตลอด 24 ชั่วโมง (86400 วิ)
                if timeSinceLast >= 0 and timeSinceLast < 86400 then
                    sessionWins = tonumber(data.wins) or 0
                    sessionDisconnects = tonumber(data.disconnects) or 0
                    cached_april_coins = tonumber(data.april_coins) or 0
                end
            end
        end
    end)
end

-- บันทึกข้อมูล Session ลงไฟล์ JSON
local function saveSessionData()
    if not isFileSystemSupported then return end
    pcall(function()
        writefile(sessionFile, HttpService:JSONEncode({
            user_id = player.UserId,
            username = player.Name,
            session_start = sessionStartTime,
            last_seen = os.time(),
            wins = sessionWins,
            disconnects = sessionDisconnects,
            april_coins = cached_april_coins
        }) .. "\n")
    end)
end

-- ฟังก์ชันแจ้งเตือน Disconnect ให้ Watchdog รู้ทันที + สั่ง Auto-Rejoin ในเกมอัตโนมัติ (Emu-Style Layer 1)
local function onDisconnectDetected(reason, errCode)
    if isKickedOrDisconnected then return end
    isKickedOrDisconnected = true
    sessionDisconnects = sessionDisconnects + 1
    disconnectReason = reason or "Roblox Disconnected / Kicked"
    disconnectErrorCode = tonumber(errCode) or 0
    warn("[AntiAFK/Watchdog] 🚨 DISCONNECT DETECTED: " .. tostring(disconnectReason))

    pcall(function()
        -- บันทึกจำนวนครั้งที่หลุดลงไฟล์ Session ก่อนรีจอ
        saveSessionData()
        -- 1. ลบ Heartbeat file ทิ้งทันที! เพื่อให้ Watchdog รู้ว่าสคริปต์หยุด
        if delfile and isfile and isfile(heartbeatFile) then
            delfile(heartbeatFile)
        end
        -- 2. เขียนไฟล์แจ้งเตือน Disconnect ให้ Watchdog (ทั้ง Android และ PC) อ่านและสั่งรีจอทันที
        if writefile then
            writefile("watchdog_disconnected.txt", tostring(disconnectReason) .. "\n")
            writefile(pcDisconnectFile, tostring(disconnectReason) .. "\n")
            writefile(pcHeartbeatFile, HttpService:JSONEncode({
                user_id = player.UserId,
                username = player.Name,
                place_id = game.PlaceId,
                game_id = tostring(game.GameId),
                job_id = tostring(game.JobId or ""),
                last_seen = os.time(),
                ui_exists = false,
                ui_enabled = false,
                teleporting = false,
                disconnected = true,
                disconnect_code = disconnectErrorCode,
                disconnect_reason = tostring(disconnectReason)
            }) .. "\n")
        end
    end)

    -- ส่งสถานะ OFFLINE และยอดหลุดล่าสุดเข้าเว็บทันที
    task.spawn(function()
        if sendTelemetry then
            pcall(sendTelemetry, "OFFLINE")
        end
    end)

    -- 3. Auto-Close Roblox to let Real re-launch clean instance (ยกเว้น Error 276/273 บัญชีซ้อน)
    local lowerReason = tostring(disconnectReason):lower()
    local isSameAccount = (disconnectErrorCode == 276 or disconnectErrorCode == 273 or lowerReason:find("same account") or lowerReason:find("276"))
    local cfg = getAutoRejoinConfig()
    if not isSameAccount and cfg.enabled then
        task.spawn(function()
            task.wait(1.5)
            warn("[Watchdog] 💀 Closing Roblox to let Real restart it automatically...")
            pcall(function() game:Shutdown() end)
        end)
    end
end

-- ดักจับกรณีผู้เล่นกดออกจากแมพกลับหน้าหลัก (Leave Game -> Roblox Home Screen) โดยไม่ได้วาร์ปย้ายด่าน
pcall(function()
    Players.PlayerRemoving:Connect(function(plr)
        pcall(function()
            if plr == player and not isTeleportingFlag then
                onDisconnectDetected("ออกจากแมพกลับหน้าหลัก (Left Game)", 2850)
            end
        end)
    end)
end)

pcall(function()
    game.Close:Connect(function()
        pcall(function()
            if not isTeleportingFlag then
                onDisconnectDetected("ออกจากแมพกลับหน้าหลัก (Game Closed)", 2850)
            end
        end)
    end)
end)

-- ดักจับเมื่อมี Error / Kick / Error Code 524 modal จาก GuiService (กรองเฉพาะ Disconnect/Error จริง ไม่นับ Code 285)
pcall(function()
    GuiService.ErrorMessageChanged:Connect(function(msg)
        pcall(function()
            local code = GuiService:GetErrorCode().Value
            local lowerMsg = tostring(msg or ""):lower()
            -- ข้ามเฉพาะ Code 285 (DisconnectClientInitiated) ตอนกำลังวาร์ปย้ายเซิร์ฟเวอร์ปกติ
            if code == 285 or lowerMsg:find("disconnectclientinitiated") then
                return
            end
            local isErr524 = (code == 524 or lowerMsg:find("524") or lowerMsg:find("permission") or lowerMsg:find("not authorized") or lowerMsg:find("ไม่มีสิทธิ์"))
            if isErr524 or code >= Enum.ConnectionError.DisconnectErrors.Value then
                onDisconnectDetected(string.format("GuiService Error [Code %d]: %s", isErr524 and 524 or code, tostring(msg)), isErr524 and 524 or code)
            end
        end)
    end)
end)

-- ดักจับเมื่อการวาร์ปย้ายด่านล้มเหลว (เช่น Error Code 524 / Unauthorized / Reserved Server ปิดตัว)
pcall(function()
    TeleportService.TeleportInitFailed:Connect(function(plr, teleportResult, errorMessage, failedPlaceId)
        pcall(function()
            if plr and plr ~= player then return end
            local resName = tostring(teleportResult and teleportResult.Name or teleportResult)
            local lowerErr = tostring(errorMessage or ""):lower()
            warn(string.format("[AutoRejoin] ⚠️ TeleportInitFailed (%s) on Place %s: %s", resName, tostring(failedPlaceId), tostring(errorMessage)))
            -- ข้ามเฉพาะกรณีที่กำลังวาร์ปซ้อนอยู่แล้ว (IsTeleporting / Flooded)
            if teleportResult == Enum.TeleportResult.IsTeleporting or teleportResult == Enum.TeleportResult.Flooded then
                return
            end
            local errCode = (teleportResult == Enum.TeleportResult.Unauthorized or lowerErr:find("524") or lowerErr:find("permission")) and 524 or 773
            onDisconnectDetected(string.format("TeleportInitFailed [%s / Code %d]: %s", resName, errCode, tostring(errorMessage)), errCode)
        end)
    end)
end)

-- ดักจับหน้าต่าง Popup เตือนหลุดทุกประเภทใน CoreGui (รวมถึง Error Code 524 และ AFK 20 นาที)
task.spawn(function()
    pcall(function()
        local CoreGui = game:GetService("CoreGui")
        local promptGui = CoreGui:WaitForChild("RobloxPromptGui", 15)
        if not promptGui then return end
        local overlay = promptGui:WaitForChild("promptOverlay", 15)
        if not overlay then return end

        local function checkPromptLabel(desc)
            if env._COOK45_TRACKER_RUN_ID ~= CURRENT_RUN_ID then return end
            if desc:IsA("TextLabel") or desc:IsA("TextBox") then
                local errCode = 0
                pcall(function() errCode = GuiService:GetErrorCode().Value end)
                if errCode == 285 then return end

                local txt = tostring(desc.Text or ""):lower()
                local is524 = (errCode == 524 or txt:find("524") or txt:find("permission") or txt:find("not authorized") or txt:find("ไม่มีสิทธิ์"))
                if is524 or txt:find("idle") or txt:find("kick") or txt:find("disconnect") or txt:find("error") or txt:find("lost connection") or txt:find("รหัสข้อผิดพลาด") then
                    if not txt:find("285") and not txt:find("disconnectclientinitiated") then
                        onDisconnectDetected("PromptModal: " .. tostring(desc.Text), is524 and 524 or errCode)
                    end
                end
            end
        end

        -- ตรวจสอบข้อความที่มีอยู่แล้วตอนสคริปต์โหลด
        for _, desc in ipairs(overlay:GetDescendants()) do
            checkPromptLabel(desc)
        end
        -- ดักจับข้อความใหม่ที่โผล่ขึ้นมาภายหลัง
        overlay.DescendantAdded:Connect(function(desc)
            task.wait(0.2)
            checkPromptLabel(desc)
        end)
    end)
end)

-- ฟังก์ชันอัปเดต Heartbeat สื่อสารกับ Watchdog CMD และบันทึก Session
local function pulseHeartbeat()
    if not isFileSystemSupported or isKickedOrDisconnected or env._COOK45_TRACKER_RUN_ID ~= CURRENT_RUN_ID then return end
    pcall(function()
        local nowEpochInt = os.time()
        local nowEpoch = tostring(nowEpochInt)
        if isTeleportingFlag and teleportStartedAt > 0 and (nowEpochInt - teleportStartedAt) > 15 and not isInGameRejoining then
            isTeleportingFlag = false
        end
        -- 1. Heartbeat สำหรับ Watchdog เช็คสถานะตัวรันใน Android (ทั้งรูปแบบ Watchdog และ Rokid)
        writefile(heartbeatFile, nowEpoch .. "\n")
        writefile(rokidCheckFile, "working:" .. nowEpoch .. "\n")
        -- Report whether the Anime Adventures control UI exists and is enabled.
        -- The Windows watchdog uses this short-lived signal for its startup check.
        local uiExists = false
        local uiEnabled = false
        pcall(function()
            local pg = player:FindFirstChild("PlayerGui")
            local ui = pg and pg:FindFirstChild("XT_AnimeAdventuresUI")
            if ui then
                uiExists = true
                if ui:IsA("LayerCollector") then
                    uiEnabled = ui.Enabled == true
                elseif ui:IsA("GuiObject") then
                    uiEnabled = ui.Visible == true
                else
                    for _, child in ipairs(ui:GetDescendants()) do
                        if (child:IsA("LayerCollector") and child.Enabled)
                            or (child:IsA("GuiObject") and child.Visible) then
                            uiEnabled = true
                            break
                        end
                    end
                end
            end
        end)
        writefile(
            animeUIStatusFile,
            string.format("%d|%s|%d|%d\n", nowEpochInt, tostring(game.GameId), uiExists and 1 or 0, uiEnabled and 1 or 0)
        )
        writefile(pcHeartbeatFile, HttpService:JSONEncode({
            user_id = player.UserId,
            username = player.Name,
            place_id = game.PlaceId,
            game_id = tostring(game.GameId),
            job_id = tostring(game.JobId or ""),
            last_seen = nowEpochInt,
            ui_exists = uiExists,
            ui_enabled = uiEnabled,
            teleporting = isTeleportingFlag,
            disconnected = false,
            disconnect_code = 0,
            disconnect_reason = ""
        }) .. "\n")
        -- 2. บันทึก Session Uptime + Wins + Disconnects สะสม ไม่ให้รีตอน Replay / Server Hop
        saveSessionData()
    end)
end

-- ส่ง Heartbeat ครั้งแรกทันทีที่โหลดสคริปต์ติด
pulseHeartbeat()

-- ลูปรับคำสั่ง In-Game Rejoin จากโปรแกรม NexusRobloxManager.exe (ทุกๆ 2 วินาที) + เช็ค UI บอทค้าง
task.spawn(function()
    local uiValidated = false
    while task.wait(2) do
        if env._COOK45_TRACKER_RUN_ID ~= CURRENT_RUN_ID then break end
        if isFileSystemSupported then
            pcall(function()
                local cmdRaw = nil
                if isfile(pcCmdByUidFile) then
                    cmdRaw = readfile(pcCmdByUidFile)
                    delfile(pcCmdByUidFile)
                elseif isfile(pcCmdByNameFile) then
                    cmdRaw = readfile(pcCmdByNameFile)
                    delfile(pcCmdByNameFile)
                end
                if cmdRaw then
                    local placeArg = tonumber(tostring(cmdRaw):match("(%d+)"))
                    startInGameTeleportLoop(placeArg, "Command from NexusRobloxManager")
                end
            end)
        end

        -- เช็คซ้ำทุก 2 วินาทีว่ามี Error Code 524 หรือ ErrorCode ค้างอยู่บนหน้าจอหรือไม่ (กันพลาดกรณีขึ้นตั้งแต่ก่อนโหลดสคริปต์เสร็จ)
        if not isKickedOrDisconnected and not isInGameRejoining then
            pcall(function()
                local code = GuiService:GetErrorCode().Value
                if code == 524 or (code >= Enum.ConnectionError.DisconnectErrors.Value and code ~= 285) then
                    onDisconnectDetected("GuiService Polling ErrorCode: " .. tostring(code), code)
                end
            end)
        end

        -- ตรวจสอบว่า XT_AnimeAdventuresUI เปิดขึ้นหรือไม่หลังเข้าแมพ Anime Adventures
        if not uiValidated and not isInGameRejoining and tonumber(game.GameId) == AA_UNIVERSE_ID then
            pcall(function()
                local pg = player:FindFirstChild("PlayerGui")
                local ui = pg and pg:FindFirstChild("XT_AnimeAdventuresUI")
                if ui then
                    uiValidated = true
                else
                    local cfg = getAutoRejoinConfig()
                    if cfg.enabled and (os.time() - scriptLoadedAt) >= cfg.ui_timeout_sec then
                        uiValidated = true
                        onDisconnectDetected("XT_AnimeAdventuresUI did not open in time", 999)
                    end
                end
            end)
        end
    end
end)

-- ส่ง Heartbeat สม่ำเสมอทุกๆ 2 วินาทีใน background thread (ตรวจจับไวเทียบเท่า Emu)
task.spawn(function()
    while task.wait(2) do
        if env._COOK45_TRACKER_RUN_ID ~= CURRENT_RUN_ID then break end
        if not isKickedOrDisconnected then
            pulseHeartbeat()
        end
    end
end)

-- ============================================================
-- 🔍 ANIME ADVENTURES LIVE DATA EXTRACTOR (Map, Team, Portals, Units, Rewards)
-- ============================================================
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local cachedAASession = nil
local cachedAAData = { loaded = false, units = nil, traits = nil, items = nil, loader = nil }
local cachedLevelData = nil
local lastNonEmptyPlacedUnits = {}

local function getAAData()
    if cachedAAData.loaded then return cachedAAData end
    cachedAAData.loaded = true
    pcall(function()
        local src = ReplicatedStorage:FindFirstChild("src")
        if src then
            local loaderMod = src:FindFirstChild("Loader")
            if loaderMod then
                local ok, L = pcall(require, loaderMod)
                if ok and type(L) == "table" then cachedAAData.loader = L end
            end
            local dataF = src:FindFirstChild("Data")
            if dataF then
                local uMod = dataF:FindFirstChild("Units")
                local tMod = dataF:FindFirstChild("Traits")
                local iMod = dataF:FindFirstChild("Items")
                if uMod then
                    local ok, d = pcall(require, uMod)
                    if ok and type(d) == "table" then cachedAAData.units = d end
                end
                if tMod then
                    local ok, d = pcall(require, tMod)
                    if ok and type(d) == "table" then cachedAAData.traits = d end
                end
                if iMod then
                    local ok, d = pcall(require, iMod)
                    if ok and type(d) == "table" then cachedAAData.items = d end
                end
            end
        end
    end)
    return cachedAAData
end

local function getAASession()
    if cachedAASession and type(cachedAASession) == "table" and cachedAASession.profile_data then
        return cachedAASession
    end
    if type(filtergc) == "function" then
        pcall(function()
            local s = filtergc("table", { Keys = { "profile_data", "collection", "inventory" } }, true)
            if type(s) == "table" and s.profile_data then
                cachedAASession = s
            end
        end)
    end
    return cachedAASession
end

local function calcPlayerLevelFromXp(xp)
    local x = tonumber(xp) or 0
    if x <= 0 then return 1 end
    return math.max(1, math.floor((math.sqrt(56 * x + 37249) - 179) * 0.07142857142857142))
end

local function calcUnitLevelFromXp(xp)
    local x = tonumber(xp) or 0
    if x <= 0 then return 1 end
    return math.max(1, math.floor((math.log(x / 1000 + 1)) / 0.0769610411361284) + 1)
end

local function trimStr(s)
    if type(s) ~= "string" then return "" end
    return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function stripRichText(s)
    if type(s) ~= "string" then return "" end
    return trimStr((s:gsub("<[^<>]->", "")))
end

local function getCurrentWave()
    local ok, val = pcall(function()
        return workspace._wave_num and tonumber(workspace._wave_num.Value) or 0
    end)
    return (ok and val) or 0
end

-- ดึงชื่อแมพเกมอัตโนมัติ (Lobby = [☀️UPD 21🏖️] Anime Adventures, Match = Haunted Academy (Summer) Summer Hunt ฯลฯ)
local gameName = "[☀️UPD 21🏖️] Anime Adventures"
pcall(function()
    local info = MarketplaceService:GetProductInfo(game.PlaceId)
    if info and info.Name and info.Name ~= "Game-2" and info.Name ~= "เกม 2" then
        gameName = info.Name
    end
end)

local function getCurrentMapInfo()
    local data = getAAData()
    local isLobby = (game.PlaceId == AA_LOBBY_PLACE_ID)
    if data.loader and data.loader.IsLobby ~= nil then
        isLobby = (data.loader.IsLobby == true)
    end

    if isLobby then
        local lobbyTitle = gameName
        pcall(function()
            local info = MarketplaceService:GetProductInfo(AA_LOBBY_PLACE_ID)
            if info and info.Name and info.Name ~= "" then
                lobbyTitle = info.Name
            end
        end)
        return {
            map_name = lobbyTitle,
            difficulty = "",
            is_lobby = true
        }
    end

    -- อยู่ในด่าน: ดึงจาก Loader.LevelData หรือ _MAP_CONFIG.GetLevelData (cache ต่อตา)
    if not cachedLevelData then
        pcall(function()
            if data.loader and type(data.loader.LevelData) == "table" and (data.loader.LevelData.name or data.loader.LevelData._location_name) then
                cachedLevelData = data.loader.LevelData
            else
                local mc = workspace:FindFirstChild("_MAP_CONFIG")
                local rf = mc and mc:FindFirstChild("GetLevelData")
                if rf and rf:IsA("RemoteFunction") then
                    local ok, res = pcall(function() return rf:InvokeServer() end)
                    if ok and type(res) == "table" then
                        cachedLevelData = res
                    end
                end
            end
        end)
    end

    local locName = cachedLevelData and trimStr(tostring(cachedLevelData._location_name or "")) or ""
    local lvlName = cachedLevelData and trimStr(tostring(cachedLevelData.name or "")) or ""
    local difficulty = cachedLevelData and trimStr(tostring(cachedLevelData._difficulty or "")) or ""

    -- สำรองจาก HUD บนหน้าจอ (Waves.HealthBar.LevelTitle)
    pcall(function()
        local pg = player:FindFirstChild("PlayerGui")
        local waves = pg and pg:FindFirstChild("Waves")
        local hb = waves and waves:FindFirstChild("HealthBar")
        local lt = hb and hb:FindFirstChild("LevelTitle")
        if lt then
            local hudMap = lt:FindFirstChild("Map") and trimStr(tostring(lt.Map.Text or "")) or ""
            local hudLvl = lt:FindFirstChild("Level") and trimStr(tostring(lt.Level.Text or "")) or ""
            if locName == "" and hudMap ~= "" then locName = hudMap end
            if lvlName == "" and hudLvl ~= "" then lvlName = hudLvl end
        end
    end)

    local combined = ""
    if locName ~= "" and lvlName ~= "" then
        if locName == lvlName then
            combined = locName
        else
            combined = locName .. " " .. lvlName
        end
    elseif locName ~= "" then
        combined = locName
    elseif lvlName ~= "" then
        combined = lvlName
    else
        combined = gameName
    end

    return {
        map_name = combined,
        difficulty = difficulty,
        is_lobby = false
    }
end

local function resolveTraitNames(rawTraits)
    local list = {}
    if type(rawTraits) ~= "table" then return list end
    local data = getAAData()
    local traitsInfo = data.traits and data.traits.info

    local function addTrait(tid)
        if type(tid) ~= "string" or tid == "" then return end
        local displayName = tid
        if traitsInfo and type(traitsInfo[tid]) == "table" and traitsInfo[tid].name then
            displayName = tostring(traitsInfo[tid].name)
        else
            displayName = tid:sub(1, 1):upper() .. tid:sub(2)
        end
        table.insert(list, displayName)
    end

    for k, v in pairs(rawTraits) do
        if type(v) == "string" then
            addTrait(v)
        elseif type(v) == "table" and (v.trait or v.id) then
            addTrait(tostring(v.trait or v.id))
        elseif v == true and type(k) == "string" then
            addTrait(k)
        end
    end
    return list
end

local function getEquippedTeam()
    local team = {}
    local data = getAAData()
    local unitsData = data.units
    local sess = getAASession()

    if sess and sess.collection and sess.collection.collection_profile_data then
        local cpd = sess.collection.collection_profile_data
        local eq = cpd.equipped_units
        local owned = cpd.owned_units
        if type(eq) == "table" and type(owned) == "table" then
            for slotIdx = 1, 6 do
                local uuid = eq[tostring(slotIdx)] or eq[slotIdx]
                if uuid and owned[uuid] then
                    local u = owned[uuid]
                    local uid = tostring(u.unit_id or "unknown")
                    local def = unitsData and unitsData[uid]
                    local unitName = (def and def.name) or uid
                    local rarity = (def and def.rarity) or ""
                    local lvl = calcUnitLevelFromXp(u.xp)
                    local traitList = resolveTraitNames(u.traits)
                    table.insert(team, {
                        slot = slotIdx,
                        unit_id = uid,
                        name = unitName,
                        level = lvl,
                        rarity = rarity,
                        shiny = (u.shiny == true),
                        traits = traitList,
                        trait = table.concat(traitList, ", ")
                    })
                end
            end
        end
    end

    -- Fallback จาก PlayerGui.spawn_units เฉพาะช่องที่มี attribute _equipped_frame_unit_uuid จริง
    if #team == 0 then
        pcall(function()
            local pg = player:FindFirstChild("PlayerGui")
            local su = pg and pg:FindFirstChild("spawn_units")
            local uf = su and su:FindFirstChild("Lives") and su.Lives:FindFirstChild("Frame") and su.Lives.Frame:FindFirstChild("Units")
            if uf then
                for slotIdx = 1, 6 do
                    local frame = uf:FindFirstChild(tostring(slotIdx))
                    if frame and frame:GetAttribute("_equipped_frame_unit_uuid") ~= nil then
                        local nObj = frame:FindFirstChild("name")
                        local lObj = frame:FindFirstChild("Main") and frame.Main:FindFirstChild("Level")
                        if nObj and nObj.Text ~= "" then
                            table.insert(team, {
                                slot = slotIdx,
                                name = trimStr(nObj.Text),
                                level = (lObj and tonumber(lObj.Text)) or 1,
                                shiny = false,
                                traits = {},
                                trait = ""
                            })
                        end
                    end
                end
            end
        end)
    end

    return team
end

local function getPortalsSummary()
    local portals = {}
    local sess = getAASession()
    local data = getAAData()
    local itemsData = data.items

    if sess and sess.inventory and sess.inventory.inventory_profile_data then
        local uniqueItems = sess.inventory.inventory_profile_data.unique_items
        if type(uniqueItems) == "table" then
            local grouped = {}
            for _, item in pairs(uniqueItems) do
                if type(item) == "table" then
                    local iid = tostring(item.item_id or item.id or "")
                    local def = itemsData and itemsData[iid]
                    local displayName = (def and def.name) or iid
                    local tier = tonumber(item._portal_depth or item.portal_depth or 0) or 0
                    if tier > 0 or iid:lower():find("portal") or tostring(displayName):lower():find("portal") then
                        local gk = displayName .. "::" .. tostring(tier)
                        if not grouped[gk] then
                            grouped[gk] = {
                                name = displayName,
                                tier = tier > 0 and tier or nil,
                                count = 0,
                                item_id = iid
                            }
                        end
                        grouped[gk].count = grouped[gk].count + 1
                    end
                end
            end
            for _, g in pairs(grouped) do
                table.insert(portals, g)
            end
            table.sort(portals, function(a, b)
                if a.count ~= b.count then return a.count > b.count end
                return tostring(a.name) < tostring(b.name)
            end)
        end
    end

    return portals
end

local function snapshotPlacedUnits()
    local summary = {}
    local unitsFolder = workspace:FindFirstChild("_UNITS")
    if not unitsFolder then return summary end
    local data = getAAData()
    local unitsData = data.units
    local grouped = {}

    for _, unit in ipairs(unitsFolder:GetChildren()) do
        pcall(function()
            local st = unit:FindFirstChild("_stats")
            local ownerVal = st and st:FindFirstChild("player")
            if ownerVal and ownerVal.Value == player then
                local idVal = st:FindFirstChild("id")
                local uid = idVal and tostring(idVal.Value) or unit.Name
                local def = unitsData and unitsData[uid]
                local unitName = (def and def.name) or unit.Name
                local upgCur = (st:FindFirstChild("upgrade") and tonumber(st.upgrade.Value)) or 0
                local upgMax = (st:FindFirstChild("max_upgrade") and tonumber(st.max_upgrade.Value))
                    or (def and type(def.upgrade) == "table" and #def.upgrade)
                    or 0
                local kills = (st:FindFirstChild("kills") and tonumber(st.kills.Value)) or 0

                local gk = string.format("%s|%d|%d", unitName, upgCur, upgMax)
                if not grouped[gk] then
                    grouped[gk] = {
                        count = 0,
                        name = unitName,
                        kills = 0,
                        upg_cur = upgCur,
                        upg_max = upgMax
                    }
                end
                grouped[gk].count = grouped[gk].count + 1
                grouped[gk].kills = grouped[gk].kills + kills
            end
        end)
    end

    for _, item in pairs(grouped) do
        table.insert(summary, item)
    end
    table.sort(summary, function(a, b)
        if a.kills ~= b.kills then return a.kills > b.kills end
        return a.count > b.count
    end)
    return summary
end

-- คอยเก็บภาพรวมยูนิตที่วางในด่านไว้เรื่อยๆ (กันกรณี AutoSell ขายทิ้งหมดก่อนจอดับ ResultsUI)
task.spawn(function()
    while task.wait(3) do
        if env._COOK45_TRACKER_RUN_ID ~= CURRENT_RUN_ID then break end
        pcall(function()
            local w = getCurrentWave()
            if w <= 1 and #lastNonEmptyPlacedUnits > 0 then
                local cur = snapshotPlacedUnits()
                if #cur == 0 then
                    lastNonEmptyPlacedUnits = {}
                end
            end
            local snap = snapshotPlacedUnits()
            if #snap > 0 then
                lastNonEmptyPlacedUnits = snap
            end
        end)
    end
end)

-- ============================================================
-- 🏆 ANIME ADVENTURES MATCH WIN & WEBHOOK DETECTOR (ResultsUI Watcher)
-- ============================================================
local hasCountedMatchResult = false
local getGameStats
local detectDeviceName

local function collectResultsRewards(holder)
    local rewards = {}
    pcall(function()
        local lr = holder and holder:FindFirstChild("LevelRewards")
        local sf = lr and lr:FindFirstChild("ScrollingFrame")
        if not sf then return end

        local labelMap = {
            XPReward = "XP",
            GoldReward = "Gold",
            GemReward = "Gems",
            TrophyReward = "Trophies",
        }
        local resLabel = "Summer Pearls"
        if cachedLevelData and cachedLevelData.roguelike_multiplier_resource then
            if tostring(cachedLevelData.roguelike_multiplier_resource) == "SummerPearls" then
                resLabel = "Summer Pearls"
            else
                resLabel = tostring(cachedLevelData.roguelike_multiplier_resource)
            end
        end

        for _, child in ipairs(sf:GetChildren()) do
            if child:IsA("GuiObject") and child.Visible and child.Name ~= "Configuration" then
                local main = child:FindFirstChild("Main")
                local amtObj = main and main:FindFirstChild("Amount")
                local amtText = amtObj and stripRichText(tostring(amtObj.Text or "")) or ""
                if amtText ~= "" then
                    local knownSuffix = labelMap[child.Name]
                    if knownSuffix then
                        if not amtText:upper():find(knownSuffix:upper()) then
                            table.insert(rewards, amtText .. " " .. knownSuffix)
                        else
                            table.insert(rewards, amtText)
                        end
                    elseif child.Name == "ResourceReward" then
                        table.insert(rewards, amtText .. " " .. resLabel)
                    else
                        local itemNameObj = (main and (main:FindFirstChild("ItemName") or main:FindFirstChild("Title") or main:FindFirstChild("name")))
                            or child:FindFirstChild("name")
                        local itemName = itemNameObj and stripRichText(tostring(itemNameObj.Text or "")) or child.Name
                        table.insert(rewards, amtText .. " " .. itemName)
                    end
                end
            end
        end
    end)
    return rewards
end

task.spawn(function()
    while task.wait(0.5) do
        if env._COOK45_TRACKER_RUN_ID ~= CURRENT_RUN_ID then break end
        pcall(function()
            local pg = player:FindFirstChild("PlayerGui")
            local rui = pg and pg:FindFirstChild("ResultsUI")
            local holder = rui and rui:FindFirstChild("Holder")
            local finished = rui and rui:FindFirstChild("Finished")
            local isResultsOpen = rui and rui.Enabled == true and (
                (holder and holder.Visible == true)
                or (finished and finished.Visible == true)
            )

            if isResultsOpen then
                if not hasCountedMatchResult then
                    hasCountedMatchResult = true
                    task.wait(0.8) -- รอ UI ใส่ Rewards / Timer / Wave ให้ครบ

                    local titleObj = holder and holder:FindFirstChild("Title")
                    local titleText = titleObj and tostring(titleObj.Text or ""):upper() or ""
                    local isDefeat = titleText:find("DEFEAT") ~= nil or titleText:find("LOSE") ~= nil or titleText:find("OVER") ~= nil
                    local isVictory = titleText:find("VICTORY") ~= nil
                        or ((rui.Enabled or (finished and finished.Visible)) and not isDefeat and titleText ~= "")
                        or (finished and finished.Visible and not isDefeat)

                    if isVictory then
                        sessionWins = sessionWins + 1
                        saveSessionData()
                        print(string.format("[FarmDashboard] 🏆 VICTORY DETECTED! Total Wins: %d", sessionWins))
                    end

                    -- เก็บข้อมูลแบบ Webhook Card ส่งเข้า /api/match-logs
                    pcall(function()
                        local gs = getGameStats and getGameStats() or { level = 1, player_xp = 0, gems = 0, gold = 0, summer_pearls = 0, rerolls = 0 }
                        local mapInfo = getCurrentMapInfo()
                        local portals = getPortalsSummary()
                        local team = getEquippedTeam()
                        local placedUnits = snapshotPlacedUnits()
                        if #placedUnits == 0 and #lastNonEmptyPlacedUnits > 0 then
                            placedUnits = lastNonEmptyPlacedUnits
                        end

                        local middle = holder and holder:FindFirstChild("Middle")
                        local timerText = middle and middle:FindFirstChild("Timer") and tostring(middle.Timer.Text or "") or ""
                        local duration = trimStr(timerText:gsub("^Total Time:%s*", ""))
                        if duration == "" then duration = "00:00" end

                        local wavesText = middle and middle:FindFirstChild("WavesCompleted") and tostring(middle.WavesCompleted.Text or "") or ""
                        local waveNum = tonumber(wavesText:match("(%d+)")) or getCurrentWave()

                        local totalKills = 0
                        local totalDamage = 0
                        local lpStats = player:FindFirstChild("_stats")
                        if lpStats then
                            local kObj = lpStats:FindFirstChild("kills") or lpStats:FindFirstChild("pve_kills")
                            local dObj = lpStats:FindFirstChild("damage_dealt")
                            if kObj and tonumber(kObj.Value) then totalKills = math.floor(tonumber(kObj.Value)) end
                            if dObj and tonumber(dObj.Value) then totalDamage = math.floor(tonumber(dObj.Value)) end
                        end

                        local rewards = collectResultsRewards(holder)

                        local matchPayload = {
                            user_id = player.UserId,
                            username = player.Name,
                            display_name = player.DisplayName,
                            avatar_url = string.format(
                                "https://www.roblox.com/headshot-thumbnail/image?userId=%d&width=150&height=150&format=png",
                                player.UserId
                            ),
                            device_name = detectDeviceName and detectDeviceName() or "PC",
                            level = gs.level,
                            player_xp = gs.player_xp or 0,
                            gems = gs.gems,
                            gold = gs.gold,
                            summer_pearls = gs.summer_pearls or gs.april_coins or 0,
                            rerolls = gs.rerolls or 0,
                            rewards = rewards,
                            portals = portals,
                            units = placedUnits,
                            team = team,
                            result = isVictory and "VICTORY" or "DEFEAT",
                            duration = duration,
                            wave = waveNum,
                            map_name = mapInfo.map_name,
                            difficulty = mapInfo.difficulty,
                            kills = totalKills,
                            damage = totalDamage,
                            logged_at = os.time()
                        }

                        task.spawn(function()
                            pcall(function()
                                httpRequest({
                                    Url = MATCH_LOG_API_URL,
                                    Method = "POST",
                                    Headers = {
                                        ["Content-Type"] = "application/json",
                                        ["User-Agent"] = "RobloxTelemetry/2.7"
                                    },
                                    Body = HttpService:JSONEncode(matchPayload)
                                })
                            end)
                            if sendTelemetry then
                                pcall(sendTelemetry, "ONLINE")
                            end
                        end)
                    end)
                end
            else
                if hasCountedMatchResult and getCurrentWave() <= 1 then
                    hasCountedMatchResult = false
                end
            end
        end)
    end
end)

-- ตัวแปรเก็บค่าล่าสุด (ป้องกันค่าเพชร/เวลกลายเป็น 0 หรือ 1 ตอนกำลังโหลดห้อง Replay)
local cached_level = 1
local cached_xp = 0
local cached_gems = 0
local cached_gold = 0
local cached_rerolls = 0

-- ฟังก์ชันคำนวณ FPS ปัจจุบัน
local currentFps = 60
RunService.RenderStepped:Connect(function(dt)
    if dt > 0 then
        currentFps = math.clamp(math.floor(1 / dt), 1, 240)
    end
end)

-- Helper: แปลงข้อความตัวเลขที่มี comma เช่น "85,400" หรือ "12.5K" เป็น number แท้
local function parseNumber(val)
    if typeof(val) == "number" then return val end
    if typeof(val) ~= "string" then return 0 end
    
    local clean = val:gsub(",", ""):gsub("%s+", ""):upper()
    local multiplier = 1
    if clean:find("K") then
        multiplier = 1000
        clean = clean:gsub("K", "")
    elseif clean:find("M") then
        multiplier = 1000000
        clean = clean:gsub("M", "")
    elseif clean:find("B") then
        multiplier = 1000000000
        clean = clean:gsub("B", "")
    end
    
    local num = tonumber(clean:match("%d+%.?%d*"))
    return num and (num * multiplier) or 0
end

-- Helper: สกัดตัวเลขเลเวลโดยเฉพาะ เช่น "Level 7 [18/142]" -> 7
local function parseLevel(val)
    if typeof(val) == "number" then return val end
    if typeof(val) ~= "string" then return nil end
    local clean = val:gsub("%s+", " ")
    -- หาตัวเลขหลังคำว่า Level / Lvl / Lv ก่อนอันดับแรก (เช่น "Level 7 [18/142]")
    local num = clean:match("[Ll]ev?e?l?%s*[:.]?%s*(%d+)") or clean:match("(%d+)")
    return num and tonumber(num) or nil
end

-- Helper: สแกนหาตัวเลขใน PlayerGui
local function findGuiStat(pattern)
    local pg = player:FindFirstChild("PlayerGui")
    if not pg then return nil end
    for _, obj in ipairs(pg:GetDescendants()) do
        if (obj:IsA("TextLabel") or obj:IsA("TextBox")) and obj.Visible then
            local objName = obj.Name:lower()
            local parentName = obj.Parent and obj.Parent.Name:lower() or ""
            if objName:find(pattern) or parentName:find(pattern) then
                local val = parseNumber(obj.Text)
                if val > 0 then return val end
            end
        end
    end
    return nil
end

-- ฟังก์ชันดึงค่า Gems / Gold / Level / AprilCoins แบบละเอียด (รองรับทั้ง Lobby และห้องเล่น Story/Match)
getGameStats = function()
    local stats = {
        gems = 0,
        gold = 0,
        level = 0,
        player_xp = 0,
        rerolls = 0,
        april_coins = 0,
        summer_pearls = 0
    }

    local foundDirectGems = false
    local foundDirectGold = false
    local foundDirectPearls = false
    local foundDirectRerolls = false

    -- 0. อ่านจาก Anime Adventures Profile Data โดยตรง (แม่นยำ 100% ทั้งใน Lobby และในแมพ)
    pcall(function()
        local sess = getAASession()
        if sess and sess.profile_data then
            local p = sess.profile_data
            if tonumber(p.gem_amount) then
                stats.gems = tonumber(p.gem_amount)
                foundDirectGems = true
            end
            if tonumber(p.gold_amount) then
                stats.gold = tonumber(p.gold_amount)
                foundDirectGold = true
            end
            if tonumber(p.trait_reroll_tokens) then
                stats.rerolls = tonumber(p.trait_reroll_tokens)
                foundDirectRerolls = true
            end
            if tonumber(p.player_xp) then
                stats.player_xp = tonumber(p.player_xp)
                stats.level = calcPlayerLevelFromXp(stats.player_xp)
            end
            if type(p.resources) == "table" and tonumber(p.resources.SummerPearls) then
                local spVal = tonumber(p.resources.SummerPearls)
                if spVal >= 0 then
                    stats.summer_pearls = spVal
                    stats.april_coins = spVal
                    foundDirectPearls = true
                end
            end
        end
    end)

    -- ตรวจสอบ _stats จาก LocalPlayer โดยตรง (Gems, Gold, Summer Coin, PlayerXP)
    pcall(function()
        local s = player:FindFirstChild("_stats")
        if s then
            local gemObj = s:FindFirstChild("gem_amount")
            if not foundDirectGems and gemObj and gemObj.Value ~= nil then
                local gVal = tonumber(gemObj.Value) or parseNumber(tostring(gemObj.Value))
                if gVal and gVal >= 0 then
                    stats.gems = gVal
                    foundDirectGems = true
                end
            end

            local goldObj = s:FindFirstChild("gold_amount")
            if not foundDirectGold and goldObj and goldObj.Value ~= nil then
                local auVal = tonumber(goldObj.Value) or parseNumber(tostring(goldObj.Value))
                if auVal and auVal >= 0 then
                    stats.gold = auVal
                    foundDirectGold = true
                end
            end

            local sp = s:FindFirstChild("_resourceSummerPearls")
            if sp and sp.Value ~= nil then
                local val = tonumber(sp.Value) or parseNumber(tostring(sp.Value))
                if val and val >= 0 then
                    stats.summer_pearls = val
                    stats.april_coins = val
                    foundDirectPearls = true
                end
            end

            local xpObj = s:FindFirstChild("player_xp")
            if xpObj and xpObj.Value ~= nil then
                local xpVal = tonumber(xpObj.Value) or 0
                if xpVal >= stats.player_xp then
                    stats.player_xp = xpVal
                    local calcLvl = calcPlayerLevelFromXp(xpVal)
                    if calcLvl > stats.level then stats.level = calcLvl end
                end
            end
        end
    end)

    local pg = player:FindFirstChild("PlayerGui")
    if pg then
        -- 1. ตรวจสอบ Level และ SummerCoin/AprilCoins จากหน้าต่างในห้องเล่น Story / Match:
        pcall(function()
            local su = pg:FindFirstChild("spawn_units")
            if su then
                local lives = su:FindFirstChild("Lives")
                if lives then
                    local lvlObj = lives:FindFirstChild("Main") 
                        and lives.Main:FindFirstChild("Desc") 
                        and lives.Main.Desc:FindFirstChild("Level")
                    
                    if lvlObj and (lvlObj:IsA("TextLabel") or lvlObj:IsA("TextBox")) then
                        local lvl = parseLevel(lvlObj.Text)
                        if lvl and lvl > 0 then
                            stats.level = lvl
                        end
                    end

                    if not foundDirectPearls then
                        local aprilObj = lives:FindFirstChild("Frame")
                            and lives.Frame:FindFirstChild("Resource")
                            and lives.Frame.Resource:FindFirstChild("AprilCoins")
                            and lives.Frame.Resource.AprilCoins:FindFirstChild("Level")

                        if aprilObj and (aprilObj:IsA("TextLabel") or aprilObj:IsA("TextBox")) then
                            local ac = parseNumber(aprilObj.Text)
                            if ac > 0 then
                                stats.april_coins = ac
                            end
                        end
                    end
                end
            end
        end)

        -- Fallback ตรวจสอบ UI สำหรับ SummerPearls / AprilCoins
        if not foundDirectPearls and (stats.summer_pearls or 0) == 0 and stats.april_coins == 0 then
            pcall(function()
                for _, obj in ipairs(pg:GetDescendants()) do
                    local n = obj.Name:lower()
                    if n:find("summerpearl") or n:find("pearl") then
                        local lbl = obj:FindFirstChild("Level") or obj:FindFirstChild("Amount") or obj
                        if lbl and (lbl:IsA("TextLabel") or lbl:IsA("TextBox")) then
                            local val = parseNumber(lbl.Text)
                            if val > 0 then
                                stats.summer_pearls = val
                                stats.april_coins = val
                                break
                            end
                        end
                    end
                end
            end)
        end

        -- 2. ตรวจสอบ UI หน้ารวมตอนอยู่ใน Lobby (Spawn UI)
        pcall(function()
            local spawnGui = pg:FindFirstChild("Spawn") and pg.Spawn:FindFirstChild("Main")
            if spawnGui then
                local top = spawnGui:FindFirstChild("Main") and spawnGui.Main:FindFirstChild("Top")
                if top then
                    if not foundDirectGems and top:FindFirstChild("Gems") and top.Gems:FindFirstChild("Amount") then
                        stats.gems = parseNumber(top.Gems.Amount.Text)
                    end
                    if not foundDirectGold and top:FindFirstChild("Gold") and top.Gold:FindFirstChild("Amount") then
                        stats.gold = parseNumber(top.Gold.Amount.Text)
                    end
                    if stats.level == 0 and top:FindFirstChild("Level") and top.Level:FindFirstChild("Amount") then
                        local lvl = parseLevel(top.Level.Amount.Text)
                        if lvl and lvl > 0 then stats.level = lvl end
                    end
                end
            end
        end)

        -- 3. ตรวจ Collection UI (หน้าดูของ/เพชร)
        if not foundDirectGems and stats.gems == 0 then
            pcall(function()
                local collection = pg:FindFirstChild("Collection") and pg.Collection:FindFirstChild("Main")
                if collection and collection:FindFirstChild("Currency") then
                    local curr = collection.Currency
                    if not foundDirectGems and curr:FindFirstChild("Gems") and curr.Gems:FindFirstChild("Amount") then
                        stats.gems = parseNumber(curr.Gems.Amount.Text)
                    end
                    if not foundDirectGold and curr:FindFirstChild("Gold") and curr.Gold:FindFirstChild("Amount") then
                        stats.gold = parseNumber(curr.Gold.Amount.Text)
                    end
                end
            end)
        end

        -- 4. ตรวจสอบลึกลงไปใน spawn_units กรณีโครงสร้างลูกเปลี่ยนตำแหน่ง
        if stats.level == 0 and pg:FindFirstChild("spawn_units") then
            pcall(function()
                for _, obj in ipairs(pg.spawn_units:GetDescendants()) do
                    if obj.Name == "Level" and (obj:IsA("TextLabel") or obj:IsA("TextBox")) and obj.Visible then
                        local lvl = parseLevel(obj.Text)
                        if lvl and lvl > 0 then
                            stats.level = lvl
                            break
                        end
                    end
                end
            end)
        end
    end

    -- 5. ตรวจสอบผ่าน leaderstats, Stats, Data, PlayerData (สำหรับเกมทั่วไป)
    for _, folderName in ipairs({"leaderstats", "Stats", "Data", "PlayerData", "_stats"}) do
        local folder = player:FindFirstChild(folderName)
        if folder then
            for _, item in ipairs(folder:GetChildren()) do
                local name = item.Name:lower()
                if not foundDirectGems and stats.gems == 0 and (name:find("gem") or name:find("diamond") or name:find("jewel") or name:find("emerald")) then
                    stats.gems = parseNumber(item.Value)
                elseif not foundDirectGold and stats.gold == 0 and (name:find("gold") or name:find("coin") or name:find("cash") or name:find("yen") or name:find("beli")) then
                    stats.gold = parseNumber(item.Value)
                elseif stats.level == 0 and (name:find("level") or name:find("lvl") or name:find("lv")) then
                    stats.level = parseLevel(item.Value) or 0
                elseif stats.rerolls == 0 and (name:find("reroll") or name:find("spin")) then
                    stats.rerolls = parseNumber(item.Value)
                end
            end
        end
    end

    -- 6. ตรวจสอบผ่าน Player Attributes
    if not foundDirectGems and stats.gems == 0 then
        for _, attr in ipairs({"Gems", "Gem", "Diamonds"}) do
            local v = player:GetAttribute(attr)
            if v ~= nil then stats.gems = parseNumber(v) break end
        end
    end
    if not foundDirectGold and stats.gold == 0 then
        for _, attr in ipairs({"Gold", "Coins", "Cash", "Yen"}) do
            local v = player:GetAttribute(attr)
            if v ~= nil then stats.gold = parseNumber(v) break end
        end
    end
    if stats.level == 0 then
        for _, attr in ipairs({"Level", "Lvl", "Lv"}) do
            local v = player:GetAttribute(attr)
            if v ~= nil then stats.level = parseLevel(v) or 0 break end
        end
    end

    -- 7. Smart UI Fallback Scanner
    if not foundDirectGems and stats.gems == 0 then
        stats.gems = findGuiStat("gem") or 0
    end
    if not foundDirectGold and stats.gold == 0 then
        stats.gold = findGuiStat("gold") or findGuiStat("coin") or 0
    end

    -- 8. Anti-Flicker Caching: ถ้ากำลังโหลดห้องแล้วหาค่าไม่เจอ ให้จำค่าล่าสุดไว้เสมอ
    if stats.level > 0 then
        cached_level = stats.level
    else
        stats.level = cached_level
    end

    if stats.gems > 0 then
        cached_gems = stats.gems
    else
        stats.gems = cached_gems
    end

    if stats.gold > 0 then
        cached_gold = stats.gold
    else
        stats.gold = cached_gold
    end

    if stats.rerolls > 0 then
        cached_rerolls = stats.rerolls
    elseif not foundDirectRerolls then
        stats.rerolls = cached_rerolls
    end

    if stats.player_xp > 0 then
        cached_xp = stats.player_xp
    else
        stats.player_xp = cached_xp
    end

    local effective_pearls = (stats.summer_pearls and stats.summer_pearls > 0 and stats.summer_pearls) or stats.april_coins or 0
    if effective_pearls > 0 then
        if effective_pearls ~= cached_summer_pearls then
            cached_summer_pearls = effective_pearls
            cached_april_coins = effective_pearls
            saveSessionData()
        end
        stats.summer_pearls = effective_pearls
        stats.april_coins = effective_pearls
    else
        stats.summer_pearls = cached_summer_pearls
        stats.april_coins = cached_summer_pearls
    end

    return stats
end

-- ฟังก์ชันส่ง Telemetry เข้าเว็บ Vercel
detectDeviceName = function()
    if isfile and readfile and isfile("device_name.txt") then
        local ok, content = pcall(readfile, "device_name.txt")
        if ok and content and #content > 0 then
            local clean = content:gsub("[\r\n]", ""):gsub("^%s+", ""):gsub("%s+$", "")
            if #clean > 0 then return clean end
        end
    end
    local isAndroid = false
    pcall(function()
        local uis = game:GetService("UserInputService")
        if uis:GetPlatform() == Enum.Platform.Android then
            isAndroid = true
        end
    end)
    if isAndroid then
        return "Android Emu"
    end
    return "PC"
end

sendTelemetry = function(customStatus)
    local pingMs = 50
    pcall(function()
        local item = Stats.Network.ServerStatsItem["Data Ping"]
        if item then pingMs = math.floor(item:GetValue()) end
    end)

    local gameStats = getGameStats()
    local curWave = getCurrentWave()
    local mapInfo = getCurrentMapInfo()
    local teamList = getEquippedTeam()
    local portalsList = getPortalsSummary()
    local devName = detectDeviceName()
    local waveStr = mapInfo.is_lobby and "Lobby" or (curWave > 0 and ("Wave " .. tostring(curWave)) or "Wave 0")

    local payload = {
        user_id = player.UserId,
        username = player.Name,
        display_name = player.DisplayName,
        device_name = devName,
        avatar_url = string.format(
            "https://www.roblox.com/headshot-thumbnail/image?userId=%d&width=150&height=150&format=png",
            player.UserId
        ),
        account_age = player.AccountAge,
        game_name = mapInfo.map_name,
        map_name = mapInfo.map_name,
        map_difficulty = mapInfo.difficulty,
        wave = waveStr,
        place_id = game.PlaceId,
        job_id = (game.JobId ~= "" and game.JobId) or "private-server",
        status = isKickedOrDisconnected and "OFFLINE" or (customStatus or "ONLINE"),
        level = gameStats.level,
        player_xp = gameStats.player_xp,
        gems = gameStats.gems,
        gold = gameStats.gold,
        april_coins = gameStats.april_coins,
        summer_pearls = gameStats.summer_pearls,
        rerolls = gameStats.rerolls,
        wins = sessionWins,
        disconnects = sessionDisconnects,
        team = teamList,
        portals = portalsList,
        extra_stats = {
            device_name = devName,
            rerolls = gameStats.rerolls,
            player_xp = gameStats.player_xp,
            map_name = mapInfo.map_name,
            difficulty = mapInfo.difficulty,
            wave = waveStr
        },
        ping = pingMs,
        fps = currentFps,
        uptime_seconds = os.time() - sessionStartTime,
        updated_at = os.time()
    }

    pulseHeartbeat()

    pcall(function()
        httpRequest({
            Url = API_URL,
            Method = "POST",
            Headers = {
                ["Content-Type"] = "application/json",
                ["User-Agent"] = "RobloxTelemetry/2.7"
            },
            Body = HttpService:JSONEncode(payload)
        })
    end)
end

-- หมายเหตุ: ไม่ผูก PlayerRemoving ด้วย OFFLINE อีกต่อไป เพื่อไม่ให้หน้าเว็บเด้งเป็น Offline ตอนกด Replay หรือย้ายห้อง
-- ฝั่ง Vercel Server มีระบบ timeout 120 วินาทีอยู่แล้ว ถ้าเกมดับจริงเว็บจะขึ้น Offline ให้เองตามธรรมชาติ

-- ส่งครั้งแรกทันที
task.spawn(function()
    task.wait(2) -- รอ GUI สร้างตัว
    if env._COOK45_TRACKER_RUN_ID ~= CURRENT_RUN_ID then return end
    sendTelemetry()
    print("[FarmDashboard] ✅ Telemetry v2.5 Connected -> " .. API_URL)

    -- วนลูปส่งต่อเนื่องทุก 15 วินาที
    while task.wait(SEND_INTERVAL) do
        if env._COOK45_TRACKER_RUN_ID ~= CURRENT_RUN_ID then break end
        sendTelemetry()
    end
end)
