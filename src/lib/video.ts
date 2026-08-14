import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPathImport from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";

const ffmpegPath = ffmpegPathImport as unknown as string | null;
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath((ffprobeStatic as unknown as { path: string }).path);

const REEL_WIDTH = 1080;
const REEL_HEIGHT = 1920;
const REEL_DEFAULT_SECONDS = 7;
const REEL_MIN_SECONDS = 5;
const REEL_MAX_SECONDS = 20;
const FPS = 30;

function probeDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format.duration ?? 0);
    });
  });
}

/**
 * Gera um vídeo curto (formato Reels 9:16) a partir da imagem de capa: efeito
 * de zoom/pan lento (Ken Burns) sobre a imagem. Se `narrationBuffer` (MP3)
 * for informado, a duração do vídeo se ajusta à narração (com uma folga no
 * fim); caso contrário o vídeo sai mudo com a duração padrão. Algumas contas
 * rejeitam vídeo sem nenhuma trilha de áudio, por isso sempre há áudio (real
 * ou silencioso).
 */
export async function generateReelFromImage(
  imageBuffer: Buffer,
  narrationBuffer?: Buffer,
): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "reel-"));
  const inputPath = path.join(dir, "cover.jpg");
  const narrationPath = path.join(dir, "narration.mp3");
  const outputPath = path.join(dir, "reel.mp4");

  try {
    await writeFile(inputPath, imageBuffer);

    let durationSeconds = REEL_DEFAULT_SECONDS;
    let narrationInputPath: string | null = null;
    if (narrationBuffer) {
      await writeFile(narrationPath, narrationBuffer);
      const narrationSeconds = await probeDurationSeconds(narrationPath);
      durationSeconds = Math.min(
        REEL_MAX_SECONDS,
        Math.max(REEL_MIN_SECONDS, Math.ceil(narrationSeconds) + 1),
      );
      narrationInputPath = narrationPath;
    }

    await runFfmpeg(inputPath, narrationInputPath, durationSeconds, outputPath);
    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runFfmpeg(
  inputPath: string,
  narrationInputPath: string | null,
  durationSeconds: number,
  outputPath: string,
): Promise<void> {
  const totalFrames = durationSeconds * FPS;
  // Zoom lento de 1.0x a 1.15x ao longo da duração do vídeo, sempre
  // enquadrando a imagem (cover) no canvas vertical 1080x1920.
  const zoompan =
    `zoompan=z='min(zoom+0.0006,1.15)':d=${totalFrames}:s=${REEL_WIDTH}x${REEL_HEIGHT}:fps=${FPS}`;
  const scaleAndCrop =
    `scale=${REEL_WIDTH * 2}:${REEL_HEIGHT * 2}:force_original_aspect_ratio=increase,` +
    `crop=${REEL_WIDTH * 2}:${REEL_HEIGHT * 2}`;

  const command = ffmpeg().input(inputPath).loop(durationSeconds);

  if (narrationInputPath) {
    command.input(narrationInputPath);
  } else {
    command.input("anullsrc=channel_layout=stereo:sample_rate=44100").inputFormat("lavfi");
  }

  return new Promise((resolve, reject) => {
    command
      .complexFilter([
        `[0:v]${scaleAndCrop},${zoompan},format=yuv420p[v]`,
        // Completa a narração com silêncio até bater com a duração do vídeo
        // (sem efeito se já for áudio silencioso/mais longo).
        `[1:a]apad[a]`,
      ])
      .outputOptions([
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-t",
        String(durationSeconds),
        "-pix_fmt",
        "yuv420p",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(new Error(`Falha ao gerar vídeo do Reel: ${err.message}`)))
      .run();
  });
}
