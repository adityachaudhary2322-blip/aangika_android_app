#include "links.h"

#include <NimBLEDevice.h>
#include <Preferences.h>
#include <WebSocketsServer.h>
#include <WiFi.h>
#include <WiFiManager.h>

#include "protocol.h"

namespace links {
namespace {

// ── Command queue (single producer per transport, single consumer) ───────
constexpr int QUEUE = 8;
Command queue[QUEUE];
volatile uint8_t head = 0, tail = 0;
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;

void enqueue(const uint8_t* data, size_t len) {
  if (!len) return;
  portENTER_CRITICAL(&mux);
  const uint8_t next = (head + 1) % QUEUE;
  if (next != tail) {                        // full: drop, never block the stack
    Command& c = queue[head];
    c.len = static_cast<uint8_t>(len > sizeof(c.bytes) ? sizeof(c.bytes) : len);
    memcpy(c.bytes, data, c.len);
    head = next;
  }
  portEXIT_CRITICAL(&mux);
}

// ── BLE ───────────────────────────────────────────────────────────────────
NimBLEServer* server = nullptr;
NimBLECharacteristic* frameChr = nullptr;
volatile bool connected = false;
volatile uint16_t mtu = 23;

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, ble_gap_conn_desc*) override { connected = true; mtu = 23; }
  void onDisconnect(NimBLEServer*) override {
    connected = false;
    mtu = 23;
    NimBLEDevice::startAdvertising();        // be findable again at once
  }
  void onMTUChange(uint16_t m, ble_gap_conn_desc*) override { mtu = m; }
};

class ControlCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c) override {
    NimBLEAttValue v = c->getValue();
    enqueue(v.data(), v.length());
  }
};

// ── Wi-Fi ─────────────────────────────────────────────────────────────────
WiFiManager wm;
WebSocketsServer ws(81);
bool wifiStarted = false;
volatile int wsClients = 0;

void onWs(uint8_t, WStype_t type, uint8_t* payload, size_t len) {
  if (type == WStype_CONNECTED) wsClients++;
  else if (type == WStype_DISCONNECTED && wsClients > 0) wsClients--;
  else if (type == WStype_BIN) enqueue(payload, len);
}

void startWifi() {
  if (wifiStarted) return;
  wifiStarted = true;
  WiFi.mode(WIFI_STA);
  wm.setConfigPortalBlocking(false);
  wm.setConfigPortalTimeout(300);
  wm.autoConnect("Aangika-Glove-Setup");     // portal only if no saved network
  ws.begin();
  ws.onEvent(onWs);
}

}  // namespace

bool nextCommand(Command& out) {
  bool got = false;
  portENTER_CRITICAL(&mux);
  if (tail != head) {
    out = queue[tail];
    tail = (tail + 1) % QUEUE;
    got = true;
  }
  portEXIT_CRITICAL(&mux);
  return got;
}

void beginBle() {
  NimBLEDevice::init(GLOVE_NAME);
  NimBLEDevice::setMTU(185);                 // ask for room for extended frames
  NimBLEDevice::setPower(ESP_PWR_LVL_P6);
  server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  NimBLEService* svc = server->createService(GLOVE_SERVICE_UUID);
  frameChr = svc->createCharacteristic(GLOVE_FRAME_UUID, NIMBLE_PROPERTY::NOTIFY | NIMBLE_PROPERTY::READ);
  NimBLECharacteristic* ctrl = svc->createCharacteristic(
      GLOVE_CONTROL_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  ctrl->setCallbacks(new ControlCallbacks());
  svc->start();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(GLOVE_SERVICE_UUID);
  adv->setScanResponse(true);
  adv->start();
}

bool bleConnected() { return connected; }
uint16_t bleMtu() { return mtu; }

void bleSend(const uint8_t* data, size_t len) {
  if (!connected || !frameChr) return;
  frameChr->setValue(data, len);
  frameChr->notify();
}

bool wifiEnabled() {
  Preferences p;
  p.begin("glove", true);
  const bool on = p.getBool("wifi", false);
  p.end();
  return on;
}

void enableWifi() {
  Preferences p;
  p.begin("glove", false);
  p.putBool("wifi", true);
  p.end();
  startWifi();
  wm.startConfigPortal("Aangika-Glove-Setup");   // explicit request: always show it
}

void beginWifiIfEnabled() {
  if (wifiEnabled()) startWifi();
}

void loopWifi() {
  if (!wifiStarted) return;
  wm.process();
  ws.loop();
}

bool wsConnected() { return wsClients > 0; }

void wsSend(const uint8_t* data, size_t len) {
  if (wifiStarted && wsClients > 0) ws.broadcastBIN(data, len);
}

}  // namespace links
