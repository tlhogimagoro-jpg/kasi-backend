# Kasi to Kasi — Backend Setup Guide

## Stack
| Layer | Tech |
|-------|------|
| Runtime | Node.js 18+ |
| Framework | Express.js |
| Database | PostgreSQL 14+ |
| ORM | Prisma |
| Real-time | Socket.IO |
| Auth | JWT (access + refresh) |
| Push notifications | Firebase Admin SDK |
| Payments | Flutterwave |

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment
```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Set up PostgreSQL
```bash
# Create database
createdb kasitokasi

# Or with psql:
psql -U postgres -c "CREATE DATABASE kasitokasi;"
```

### 4. Run migrations + generate Prisma client
```bash
npm run db:migrate    # creates tables
npm run db:generate   # generates client
npm run db:seed       # loads test data
```

### 5. Start the server
```bash
npm run dev     # development (nodemon)
npm start       # production
```

---

## API Endpoints

### Auth  `/api/auth`
| Method | Path | Description |
|--------|------|-------------|
| POST | `/register` | Create account (password-based) |
| POST | `/login` | Login → returns tokens |
| POST | `/refresh` | Refresh access token |
| GET | `/profile` | Get current user |
| PUT | `/profile` | Update profile / FCM token |
| POST | `/logout` | Invalidate refresh token |
| POST | `/otp/verify` | **Firebase Phone OTP** — exchange Firebase ID token for JWT |
| POST | `/otp/link-password` | Add a password to an OTP account (optional) |
| GET | `/otp/status` | Check if current user's phone is verified |

### OTP Login Flow (Firebase Phone Auth)
```
ANDROID APP                          BACKEND
───────────────────────────────────────────────────────
1. User enters phone number
2. App calls Firebase Auth SDK       (no backend call)
   → Firebase sends SMS OTP
3. User types the 6-digit code
4. App verifies OTP with Firebase
   → Firebase returns idToken
5. App sends idToken to backend  →   POST /api/auth/otp/verify
                                      { firebaseIdToken, name?, email? }
6. Backend verifies with             ← { accessToken, refreshToken, user, isNewUser }
   Firebase Admin SDK
7. App stores JWT tokens
   → User is logged in
```
**To enable in Firebase Console:** Authentication → Sign-in method → Phone → Enable

### Passenger  `/api/passenger`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/routes/nearby` | Find matching taxis near pickup → dropoff |
| POST | `/trips` | Book a trip |
| GET | `/trips/:id` | Get live trip status |
| PUT | `/trips/:id/cancel` | Cancel trip |
| GET | `/trips/history` | My past trips |
| POST | `/trips/:id/rate` | Rate driver (1–5 stars) |

### Driver  `/api/driver`  *(requires verified driver profile)*
| Method | Path | Description |
|--------|------|-------------|
| PUT | `/go-online` | Go online (share location) |
| PUT | `/go-offline` | Go offline |
| POST | `/routes` | Create a route |
| GET | `/routes/active` | Get current active route |
| PUT | `/routes/:id/complete` | End route |
| GET | `/trips/pending` | Trips nearby waiting for a driver |
| PUT | `/trips/:id/accept` | Accept a trip request |
| PUT | `/trips/:id/pickup` | Confirm passenger picked up |
| PUT | `/trips/:id/complete` | Complete trip + auto-split fare |
| GET | `/earnings` | Earnings summary (week/month/all) |

### Courier  `/api/courier`
| Method | Path | Description |
|--------|------|-------------|
| POST | `/bookings` | Book a parcel delivery |
| GET | `/bookings` | My bookings |
| GET | `/bookings/available` | Available jobs (driver) |
| GET | `/bookings/:id` | Track a booking |
| PUT | `/bookings/:id/cancel` | Cancel booking |
| PUT | `/bookings/:id/accept` | Accept job (driver) |
| PUT | `/bookings/:id/collect` | Mark collected (driver) |
| PUT | `/bookings/:id/deliver` | Mark delivered (driver) |

### Payments  `/api/payments`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/history` | Payment history |
| POST | `/initiate` | Start card payment via Flutterwave |
| POST | `/webhook` | Flutterwave webhook (no auth) |

---

## Socket.IO Events

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `driver:location_update` | `{lat, lng, heading, speed}` | Driver broadcasts location |
| `join:trip` | `{tripId}` | Join a trip's real-time room |
| `follow:driver` | `{driverId}` | Subscribe to a driver's location |

### Server → Client
| Event | Payload | Description |
|-------|---------|-------------|
| `driver:location` | `{driverId, lat, lng, heading, speed}` | Live driver position |
| `trip:status` | `{tripId, status, message}` | Trip state change |
| `trip:new_request` | `Trip object` | New trip near driver (driver only) |

---

## Payment Split
Every fare is automatically split on trip/delivery completion:

| Recipient | Share |
|-----------|-------|
| Driver | **75%** |
| Platform | 10% |
| Workshop Fund | 8% |
| Taxi Association | 7% |

Configured in `.env` — change without touching code.

---

## Connecting to the Android App
In `app/build.gradle` set:
```gradle
buildConfigField "String", "BASE_URL", '"http://YOUR_PC_IP:3000/api/"'
buildConfigField "String", "SOCKET_URL", '"http://YOUR_PC_IP:3000"'
```

Find your PC's IP with `ipconfig` (Windows) or `ifconfig` (Mac/Linux).
Make sure your phone and PC are on the same WiFi network.
