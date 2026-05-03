# ARSL Hand Landmarks Capture System

A browser-based data collection tool for building an Arabic Sign Language (ARSL) dataset. It uses your webcam and Google MediaPipe to detect hand landmarks in real time, then uploads labelled gesture recordings to Supabase Storage.

## Features

- Real-time hand landmark detection via MediaPipe Tasks Vision (GPU-accelerated)
- Static signs — single averaged frame; dynamic signs — full frame sequences
- Per-label progress tracking (50 samples required per sign)
- 30 labels across 4 categories: Numbers, Greetings, Basic Words, Colors
- Recordings are wrist-normalised before upload

## Tech Stack

- [React 19](https://react.dev) + [Vite](https://vite.dev)
- [@mediapipe/tasks-vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
- [@supabase/supabase-js](https://supabase.com/docs/reference/javascript)

## Prerequisites

- Node.js 18+
- A webcam
- A [Supabase](https://supabase.com) project

## Setup

### 1. Clone and install

```bash
git clone https://github.com/your-username/hand-landmarks-capture-system.git
cd hand-landmarks-capture-system
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL — e.g. `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key |

Both are found in your Supabase dashboard under **Settings → API**.

> The app works without Supabase — landmark detection still runs — but recording will fail to upload.

### 3. Create the Supabase storage bucket

In your Supabase dashboard:

1. Go to **Storage** and create a bucket named `arsl-dataset`
2. Make it **public**, or configure an RLS policy that allows anonymous uploads to the `raw/` prefix

### 4. Run the dev server

```bash
npm run dev
```

## Usage

1. Open the app in your browser and grant camera access when prompted
2. Wait for the **Detecting** status indicator (green) — MediaPipe downloads the model on first load
3. Select a sign from the dropdown
4. Click **Start Recording**, perform the sign, then click **Stop**
5. The recording is trimmed to the hand-visible frames, normalised, and uploaded automatically

## Dataset format

Each sample is saved as a JSON file at `arsl-dataset/raw/{base64label}-{timestamp}.json`:

```json
{
  "label": "مرحبا",
  "type": "dynamic",
  "mirrorable": false,
  "captured_at": "2024-01-01T00:00:00.000Z",
  "frame_count": 42,
  "frames": [
    {
      "landmarks": [
        { "x": 0.0, "y": 0.0, "z": 0.0 },
        { "x": 0.12, "y": -0.08, "z": 0.01 }
      ]
    }
  ]
}
```

Landmark coordinates are normalised relative to the wrist (landmark 0) and scaled by the wrist-to-middle-finger-base distance, making them invariant to hand size and position.

## Available scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Locally preview the production build |
| `npm run lint` | Run ESLint |

## License

[MIT](LICENSE)
