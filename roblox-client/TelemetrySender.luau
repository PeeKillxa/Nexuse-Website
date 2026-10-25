-- ============================================================================
-- ROBLOX MULTI-ACCOUNT FARM TELEMETRY SENDER (Luau Executor Script)
-- วิธีใช้งาน: นำไปใส่ในโฟลเดอร์ autoexec ของ Executor ทุกจอที่เปิดฟาร์ม
-- ============================================================================

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local Stats = game:GetService("Stats")
local MarketplaceService = game:GetService("MarketplaceService")
local RunService = game:GetService("RunService")

-- เปลี่ยน URL ด้านล่างให้เป็น URL เว็บ Vercel ของคุณ
local API_URL = "https://your-project-name.vercel.app/api/telemetry"
local SEND_INTERVAL = 15 -- ส่งข้อมูลทุกๆ 15 วินาที (หากขาดการติดต่อเกิน 60 วินาที หน้าเว็บจะขึ้น OFFLINE)
local startTime = os.time()

local httpRequest = (syn and syn.request)
    or (http and http.request)
    or http_request
    or (fluxus and fluxus.request)
    or request

if not httpRequest then
    warn("[FarmDashboard] Executor ของคุณไม่รองรับ http_request")
    return
end

local player = Players.LocalPlayer or Players.PlayerAdded:Wait()

-- ดึงชื่อแมพเกมอัตโนมัติ
local gameName = "Anime Adventures"
pcall(function()
    local info = MarketplaceService:GetProductInfo(game.PlaceId)
    if info and info.Name then
        gameName = info.Name
    end
end)

-- คำนวณ FPS แบบเรียลไทม์
local currentFps = 60
RunService.RenderStepped:Connect(function(dt)
    if dt > 0 then
        currentFps = math.clamp(math.floor(1 / dt), 1, 240)
    end
end)

-- ฟังก์ชันดึงค่า Gems / Gold / Level / Rerolls จาก leaderstats หรือ Attributes
local function getStatValue(candidateNames, fallback)
    for _, folderName in ipairs({ "leaderstats", "Stats", "Data", "PlayerData", "Currencies" }) do
        local folder = player:FindFirstChild(folderName)
        if folder then
            for _, name in ipairs(candidateNames) do
                local valObj = folder:FindFirstChild(name)
                if valObj and valObj.Value ~= nil then
                    return tonumber(valObj.Value) or fallback
                end
            end
        end
    end
    for _, name in ipairs(candidateNames) do
        local attr = player:GetAttribute(name)
        if attr ~= nil then
            return tonumber(attr) or fallback
        end
    end
    return fallback
end

local function sendTelemetry()
    local pingMs = 58
    pcall(function()
        pingMs = math.floor(Stats.Network.ServerStatsItem["Data Ping"]:GetValue())
    end)

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
        job_id = game.JobId ~= "" and game.JobId or "server-job-uuid",
        status = "ONLINE",
        level = getStatValue({ "Level", "Lvl", "lv" }, 125),
        gems = getStatValue({ "Gems", "Gem", "Jewels", "Emeralds" }, 0),
        gold = getStatValue({ "Gold", "Coins", "Cash", "Yen", "Beli" }, 0),
        extra_stats = {
            rerolls = getStatValue({ "Rerolls", "TraitRerolls", "Spins" }, 0),
        },
        ping = pingMs,
        fps = currentFps,
        uptime_seconds = os.time() - startTime,
        updated_at = os.time(),
    }

    pcall(function()
        httpRequest({
            Url = API_URL,
            Method = "POST",
            Headers = {
                ["Content-Type"] = "application/json",
            },
            Body = HttpService:JSONEncode(payload),
        })
    end)
end

task.spawn(function()
    while task.wait(SEND_INTERVAL) do
        sendTelemetry()
    end
end)

sendTelemetry()
print("[FarmDashboard] Telemetry Active -> " .. API_URL)
