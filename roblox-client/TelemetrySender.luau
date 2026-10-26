-- ============================================================
-- 🤖 ROBLOX MULTI-ACCOUNT FARM TELEMETRY SENDER (v2.5)
-- Optimized for: Anime Adventures (Lobby + Story/Match) & All Games
-- Author: cook45 for clack (Tuned for nexuse-website.vercel.app & Rokid Watchdog v3.0)
-- วางสคริปต์นี้ใน Auto-Execute ของ Executor ทุกจอ
-- ============================================================

if not game:IsLoaded() then
    game.Loaded:Wait()
end

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

local API_URL = "https://nexuse-website.vercel.app/api/telemetry"
local SEND_INTERVAL = 15 -- ส่งข้อมูลทุกๆ 15 วินาที

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
local rokidCheckFile = string.format("executor_check_%s.txt", tostring(player.Name))
local isKickedOrDisconnected = false
local disconnectReason = ""

-- ล้างไฟล์แจ้งเตือนหลุดค้างเก่าทันทีเมื่อสคริปต์โหลดเข้าแมพสำเร็จ
pcall(function()
    if delfile and isfile and isfile("watchdog_disconnected.txt") then
        delfile("watchdog_disconnected.txt")
    end
end)

-- ดักจับการวาร์ปย้ายแมพ (Lobby <-> Match / Replay) เพื่อส่งสัญญาณให้ Watchdog ขยายเวลาโหลด
pcall(function()
    player.OnTeleport:Connect(function(teleportState)
        pcall(function()
            if writefile then
                local nowStr = tostring(os.time()) .. "\n"
                writefile(heartbeatFile, nowStr)
                writefile(rokidCheckFile, "working:" .. tostring(os.time()))
            end
            if delfile and isfile and isfile("watchdog_disconnected.txt") then
                delfile("watchdog_disconnected.txt")
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

-- ฟังก์ชันแจ้งเตือน Disconnect ให้ Watchdog ฝั่ง Python รู้ทันที
local function onDisconnectDetected(reason)
    if isKickedOrDisconnected then return end
    isKickedOrDisconnected = true
    sessionDisconnects = sessionDisconnects + 1
    disconnectReason = reason or "Roblox Disconnected / Kicked"
    warn("[AntiAFK/Watchdog] 🚨 DISCONNECT DETECTED: " .. tostring(disconnectReason))

    pcall(function()
        -- บันทึกจำนวนครั้งที่หลุดลงไฟล์ Session ก่อนรีจอ
        saveSessionData()
        -- 1. ลบ Heartbeat file ทิ้งทันที! เพื่อให้ Watchdog รู้ว่าสคริปต์หยุด
        if delfile and isfile and isfile(heartbeatFile) then
            delfile(heartbeatFile)
        end
        -- 2. เขียนไฟล์แจ้งเตือน Disconnect ให้ Watchdog ฝั่ง Python อ่านและสั่งรีจอทันที
        if writefile then
            writefile("watchdog_disconnected.txt", tostring(disconnectReason) .. "\n")
        end
    end)

    -- ส่งสถานะ OFFLINE และยอดหลุดล่าสุดเข้าเว็บทันที
    task.spawn(function()
        if sendTelemetry then
            pcall(sendTelemetry, "OFFLINE")
        end
    end)
end

-- ดักจับเมื่อมี Error / Kick modal จาก GuiService (กรองเฉพาะ Disconnect จริง ไม่นับ Teleport / Replay Code 285)
pcall(function()
    GuiService.ErrorMessageChanged:Connect(function(msg)
        pcall(function()
            local code = GuiService:GetErrorCode().Value
            local lowerMsg = tostring(msg or ""):lower()
            -- ข้าม Code 285 (DisconnectClientInitiated) และการวาร์ปย้ายเซิร์ฟเวอร์ปกติทั้งหมด
            if code == 285 or lowerMsg:find("disconnectclientinitiated") or lowerMsg:find("teleport") or lowerMsg:find("joining") then
                return
            end
            if code >= Enum.ConnectionError.DisconnectErrors.Value then
                onDisconnectDetected(string.format("GuiService Error [Code %d]: %s", code, tostring(msg)))
            end
        end)
    end)
end)

-- ดักจับหน้าต่าง Popup เตือนหลุดทุกประเภทใน CoreGui (รวมถึง AFK 20 นาที)
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
                if txt:find("idle") or txt:find("kick") or txt:find("disconnect") or txt:find("error") or txt:find("lost connection") then
                    if not txt:find("teleport") and not txt:find("joining") and not txt:find("285") and not txt:find("disconnectclientinitiated") then
                        onDisconnectDetected("PromptModal: " .. tostring(desc.Text))
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
        local nowEpoch = tostring(os.time())
        -- 1. Heartbeat สำหรับ Watchdog เช็คสถานะตัวรันใน Android (ทั้งรูปแบบ Watchdog และ Rokid)
        writefile(heartbeatFile, nowEpoch .. "\n")
        writefile(rokidCheckFile, "working:" .. nowEpoch .. "\n")
        -- 2. บันทึก Session Uptime + Wins + Disconnects สะสม ไม่ให้รีตอน Replay / Server Hop
        saveSessionData()
    end)
end

-- ส่ง Heartbeat ครั้งแรกทันทีที่โหลดสคริปต์ติด
pulseHeartbeat()

-- ส่ง Heartbeat สม่ำเสมอทุกๆ 5 วินาทีใน background thread
task.spawn(function()
    while task.wait(5) do
        if env._COOK45_TRACKER_RUN_ID ~= CURRENT_RUN_ID then break end
        if not isKickedOrDisconnected then
            pulseHeartbeat()
        end
    end
end)

-- ============================================================
-- 🏆 ANIME ADVENTURES MATCH WIN DETECTOR (ResultsUI Watcher)
-- ตรวจจับหน้าจอจบด่าน (ResultsUI.Holder.Title == "VICTORY" หรือ ResultsUI.Finished)
-- บันทึกจำนวนครั้งที่ชนะ (sessionWins) ลงไฟล์ทันทีและส่งเข้าเว็บก่อนวาร์ป Replay
-- ============================================================
local hasCountedMatchResult = false

local function getCurrentWave()
    local ok, val = pcall(function()
        return workspace._wave_num and tonumber(workspace._wave_num.Value) or 0
    end)
    return (ok and val) or 0
end

task.spawn(function()
    while task.wait(0.5) do
        if env._COOK45_TRACKER_RUN_ID ~= CURRENT_RUN_ID then break end
        pcall(function()
            local pg = player:FindFirstChild("PlayerGui")
            local rui = pg and pg:FindFirstChild("ResultsUI")
            local holder = rui and rui:FindFirstChild("Holder")
            local finished = rui and rui:FindFirstChild("Finished")
            local isResultsOpen = rui and (
                rui.Enabled == true
                or (holder and holder.Visible == true)
                or (finished and finished.Visible == true)
            )

            if isResultsOpen then
                if not hasCountedMatchResult then
                    local titleObj = holder and holder:FindFirstChild("Title")
                    local titleText = titleObj and tostring(titleObj.Text or ""):upper() or ""
                    local isDefeat = titleText:find("DEFEAT") ~= nil or titleText:find("LOSE") ~= nil or titleText:find("OVER") ~= nil
                    local isVictory = titleText:find("VICTORY") ~= nil
                        or ((rui.Enabled or (finished and finished.Visible)) and not isDefeat and titleText ~= "")
                        or (finished and finished.Visible and not isDefeat)

                    if isVictory or isDefeat then
                        hasCountedMatchResult = true
                        if isVictory then
                            sessionWins = sessionWins + 1
                            saveSessionData()
                            print(string.format("[FarmDashboard] 🏆 VICTORY DETECTED! Total Wins: %d", sessionWins))
                            if sendTelemetry then
                                task.spawn(function()
                                    pcall(sendTelemetry, "ONLINE")
                                end)
                            end
                        end
                    end
                end
            else
                -- รีเซ็ตตัวล็อกเมื่อปิดหน้า ResultsUI หรือเริ่มเวฟใหม่ (Wave 0/1)
                if hasCountedMatchResult and getCurrentWave() <= 1 then
                    hasCountedMatchResult = false
                end
            end
        end)
    end
end)

-- ตัวแปรเก็บค่าล่าสุด (ป้องกันค่าเพชร/เวลกลายเป็น 0 หรือ 1 ตอนกำลังโหลดห้อง Replay)
local cached_level = 1
local cached_gems = 0
local cached_gold = 0
local cached_rerolls = 0

-- ดึงชื่อแมพเกมอัตโนมัติ
local gameName = "Roblox Game"
pcall(function()
    local info = MarketplaceService:GetProductInfo(game.PlaceId)
    if info and info.Name then gameName = info.Name end
end)

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
local function getGameStats()
    local stats = {
        gems = 0,
        gold = 0,
        level = 0,
        rerolls = 0,
        april_coins = 0
    }

    local pg = player:FindFirstChild("PlayerGui")
    if pg then
        -- 1. ตรวจสอบ Level และ AprilCoins จากหน้าต่างในห้องเล่น Story / Match:
        -- Level Path: PlayerGui.spawn_units.Lives.Main.Desc.Level
        -- AprilCoins Path: PlayerGui.spawn_units.Lives.Frame.Resource.AprilCoins.Level
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
        end)

        -- Fallback สำหรับ AprilCoins กรณีอยู่ในหน้าต่างอื่นของ spawn_units หรือ PlayerGui
        if stats.april_coins == 0 then
            pcall(function()
                for _, obj in ipairs(pg:GetDescendants()) do
                    if obj.Name == "AprilCoins" then
                        local lbl = obj:FindFirstChild("Level") or obj:FindFirstChild("Amount")
                        if lbl and (lbl:IsA("TextLabel") or lbl:IsA("TextBox")) then
                            local val = parseNumber(lbl.Text)
                            if val > 0 then
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
                    if top:FindFirstChild("Gems") and top.Gems:FindFirstChild("Amount") then
                        stats.gems = parseNumber(top.Gems.Amount.Text)
                    end
                    if top:FindFirstChild("Gold") and top.Gold:FindFirstChild("Amount") then
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
        if stats.gems == 0 then
            pcall(function()
                local collection = pg:FindFirstChild("Collection") and pg.Collection:FindFirstChild("Main")
                if collection and collection:FindFirstChild("Currency") then
                    local curr = collection.Currency
                    if curr:FindFirstChild("Gems") and curr.Gems:FindFirstChild("Amount") then
                        stats.gems = parseNumber(curr.Gems.Amount.Text)
                    end
                    if curr:FindFirstChild("Gold") and curr.Gold:FindFirstChild("Amount") then
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
                if stats.gems == 0 and (name:find("gem") or name:find("diamond") or name:find("jewel") or name:find("emerald")) then
                    stats.gems = parseNumber(item.Value)
                elseif stats.gold == 0 and (name:find("gold") or name:find("coin") or name:find("cash") or name:find("yen") or name:find("beli")) then
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
    if stats.gems == 0 then
        for _, attr in ipairs({"Gems", "Gem", "Diamonds"}) do
            local v = player:GetAttribute(attr)
            if v ~= nil then stats.gems = parseNumber(v) break end
        end
    end
    if stats.gold == 0 then
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
    if stats.gems == 0 then
        stats.gems = findGuiStat("gem") or 0
    end
    if stats.gold == 0 then
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
    else
        stats.rerolls = cached_rerolls
    end

    if stats.april_coins > 0 then
        if stats.april_coins ~= cached_april_coins then
            cached_april_coins = stats.april_coins
            saveSessionData()
        end
    else
        stats.april_coins = cached_april_coins
    end

    return stats
end

-- ฟังก์ชันส่ง Telemetry เข้าเว็บ Vercel
sendTelemetry = function(customStatus)
    local pingMs = 50
    pcall(function()
        local item = Stats.Network.ServerStatsItem["Data Ping"]
        if item then pingMs = math.floor(item:GetValue()) end
    end)

    local gameStats = getGameStats()
    local curWave = getCurrentWave()

    local payload = {
        user_id = player.UserId,
        username = player.Name,
        display_name = player.DisplayName,
        avatar_url = string.format(
            "https://www.roblox.com/headshot-thumbnail/image?userId=%d&width=150&height=150&format=png",
            player.UserId
        ),
        account_age = player.AccountAge,
        game_name = gameName,
        place_id = game.PlaceId,
        job_id = (game.JobId ~= "" and game.JobId) or "private-server",
        status = isKickedOrDisconnected and "OFFLINE" or (customStatus or "ONLINE"),
        level = gameStats.level,
        gems = gameStats.gems,
        gold = gameStats.gold,
        april_coins = gameStats.april_coins,
        wins = sessionWins,
        disconnects = sessionDisconnects,
        extra_stats = {
            rerolls = gameStats.rerolls,
            wave = curWave > 0 and ("Wave " .. tostring(curWave)) or "Lobby"
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
                ["User-Agent"] = "RobloxTelemetry/2.5"
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
