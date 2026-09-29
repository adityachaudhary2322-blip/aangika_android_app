// Transports: BLE GATT (primary) and a Wi-Fi WebSocket on port 81 (fallback).
// Both carry the same frames (protocol.h) and accept the same commands.
#pragma once
#include <Arduino.h>

namespace links {

// A command received on either transport, queued for the main loop so that
// callbacks never block on audio or flash writes.
struct Command { uint8_t bytes[8]; uint8_t len; };
bool nextCommand(Command& out);

// BLE
void beginBle();
bool bleConnected();
uint16_t bleMtu();               // negotiated ATT MTU (23 until negotiated)
void bleSend(const uint8_t* data, size_t len);

// Wi-Fi (only when enabled; setup via captive portal "Aangika-Glove-Setup")
bool wifiEnabled();              // persisted choice
void enableWifi();               // persist + start (portal if no saved network)
void beginWifiIfEnabled();
void loopWifi();                 // pump the portal and the WebSocket
bool wsConnected();
void wsSend(const uint8_t* data, size_t len);

}  // namespace links
