import { ChangeDetectionStrategy, Component, signal, OnInit, PLATFORM_ID, inject, ViewChild, ElementRef, AfterViewInit, OnDestroy, NgZone } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import type { IAgoraRTCClient, ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteVideoTrack, IRemoteAudioTrack } from 'agora-rtc-sdk-ng';

const AGORA_APP_ID = 'ccd55ca11eb044efa9c85caed54542e5';
const CHANNEL_NAME = 'virtual-tryon-demo';

const drawItem = (ctx: CanvasRenderingContext2D, img: HTMLImageElement | HTMLVideoElement, type: string, landmarks: any, w: number, h: number) => {
  const getPx = (lm: any) => ({ x: lm.x * w, y: lm.y * h });
  
  if (type === 'shirt') {
    const ls = getPx(landmarks[11]);
    const rs = getPx(landmarks[12]);
    const lh = getPx(landmarks[23]);
    const rh = getPx(landmarks[24]);
    
    const shoulderCenter = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const hipCenter = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
    
    const dx = rs.x - ls.x;
    const dy = rs.y - ls.y;
    const angle = Math.atan2(dy, dx);
    
    const shoulderWidth = Math.sqrt(dx*dx + dy*dy);
    const torsoHeight = Math.sqrt(Math.pow(hipCenter.x - shoulderCenter.x, 2) + Math.pow(hipCenter.y - shoulderCenter.y, 2));
    
    const imgWidth = shoulderWidth * 2.2; 
    const imgHeight = torsoHeight * 1.4; 
    
    ctx.save();
    ctx.translate(shoulderCenter.x, shoulderCenter.y + torsoHeight * 0.1);
    ctx.rotate(angle);
    ctx.drawImage(img, -imgWidth / 2, -imgHeight * 0.15, imgWidth, imgHeight);
    ctx.restore();
  } else if (type === 'hat') {
    const lEar = getPx(landmarks[7]);
    const rEar = getPx(landmarks[8]);
    const nose = getPx(landmarks[0]);
    
    const dx = rEar.x - lEar.x;
    const dy = rEar.y - lEar.y;
    const angle = Math.atan2(dy, dx);
    const headWidth = Math.sqrt(dx*dx + dy*dy);
    
    const imgWidth = headWidth * 2.0;
    const imgHeight = imgWidth * ((img as HTMLImageElement).height / (img as HTMLImageElement).width || 1);
    
    ctx.save();
    ctx.translate(nose.x, nose.y - headWidth * 0.9);
    ctx.rotate(angle);
    ctx.drawImage(img, -imgWidth / 2, -imgHeight / 2, imgWidth, imgHeight);
    ctx.restore();
  } else if (type === 'goggle') {
    const lEye = getPx(landmarks[2]);
    const rEye = getPx(landmarks[5]);
    
    const dx = rEye.x - lEye.x;
    const dy = rEye.y - lEye.y;
    const angle = Math.atan2(dy, dx);
    const eyeDist = Math.sqrt(dx*dx + dy*dy);
    
    const imgWidth = eyeDist * 2.8;
    const imgHeight = imgWidth * ((img as HTMLImageElement).height / (img as HTMLImageElement).width || 0.5);
    
    const center = { x: (lEye.x + rEye.x) / 2, y: (lEye.y + rEye.y) / 2 };
    
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(angle);
    ctx.drawImage(img, -imgWidth / 2, -imgHeight / 2, imgWidth, imgHeight);
    ctx.restore();
  }
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, AfterViewInit, OnDestroy {
  private platformId = inject(PLATFORM_ID);
  private ngZone = inject(NgZone);

  role = signal<'seller' | 'buyer' | null>(null);
  inCall = signal(false);
  
  agoraClient: IAgoraRTCClient | null = null;
  localVideoTrack: ICameraVideoTrack | null = null;
  localAudioTrack: IMicrophoneAudioTrack | null = null;
  remoteVideoTrack: IRemoteVideoTrack | null = null;
  remoteAudioTrack: IRemoteAudioTrack | null = null;

  @ViewChild('remoteVideoContainer') remoteVideoContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('localVideoElement') videoElement?: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement') canvasElement?: ElementRef<HTMLCanvasElement>;

  poseLandmarker: PoseLandmarker | null = null;
  webcamRunning = signal(false);
  measurements = signal<{ height: number, shoulder: number, arm: number, torso: number, legs: number } | null>(null);
  statusText = signal<string>('Initializing model...');
  statusColor = signal<string>('text-yellow-400');
  
  private animationFrameId: number | null = null;
  private lastVideoTime = -1;
  
  smoothedPixelsPerCm = 0;

  availableItems = [
    { id: 'red-shirt', type: 'shirt', url: 'https://upload.wikimedia.org/wikipedia/commons/2/24/T-shirt-red.svg', name: 'Red T-Shirt' },
    { id: 'blue-shirt', type: 'shirt', url: 'https://upload.wikimedia.org/wikipedia/commons/8/81/T-shirt-blue.svg', name: 'Blue T-Shirt' },
    { id: 'green-shirt', type: 'shirt', url: 'https://upload.wikimedia.org/wikipedia/commons/0/07/T-shirt-green.svg', name: 'Green T-Shirt' },
    { id: 'fedora', type: 'hat', url: 'https://upload.wikimedia.org/wikipedia/commons/1/1b/Fedora.svg', name: 'Fedora Hat' },
    { id: 'sunglasses', type: 'goggle', url: 'https://upload.wikimedia.org/wikipedia/commons/0/0c/Sunglasses_icon.svg', name: 'Sunglasses' }
  ];
  selectedItems = signal<Record<string, string>>({});
  itemImages: Record<string, HTMLImageElement> = {};

  async ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      // Preload images
      this.availableItems.forEach(item => {
        const img = new Image();
        img.src = item.url;
      });
    }
  }

  async ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) {
      await this.initializeMediaPipe();
    }
  }

  ngOnDestroy() {
    this.leaveCall();
  }

  async initializeMediaPipe() {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
      );
      this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numPoses: 1
      });
      this.statusText.set('Ready. Select a role to join the call.');
      this.statusColor.set('text-emerald-400');
    } catch (error) {
      console.error(error);
      this.statusText.set('Error loading model.');
      this.statusColor.set('text-red-500');
    }
  }

  async joinCall(selectedRole: 'seller' | 'buyer') {
    if (!this.poseLandmarker) {
      alert("Please wait for the AI model to load.");
      return;
    }

    this.role.set(selectedRole);
    this.inCall.set(true);
    this.statusText.set('Connecting to call...');
    this.statusColor.set('text-yellow-400');

    try {
      const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
      this.agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

      if (!this.agoraClient) return;

      this.agoraClient.on('user-published', async (user, mediaType) => {
        await this.agoraClient!.subscribe(user, mediaType);
        if (mediaType === 'video') {
          this.remoteVideoTrack = user.videoTrack || null;
          setTimeout(() => {
            if (this.remoteVideoContainer && this.remoteVideoTrack) {
              this.remoteVideoContainer.nativeElement.innerHTML = '';
              this.remoteVideoTrack.play(this.remoteVideoContainer.nativeElement);
            }
          }, 100);
        }
        if (mediaType === 'audio') {
          this.remoteAudioTrack = user.audioTrack || null;
          this.remoteAudioTrack?.play();
        }
      });

      this.agoraClient.on('user-unpublished', (user, mediaType) => {
        if (mediaType === 'video') {
          if (this.remoteVideoContainer) {
            this.remoteVideoContainer.nativeElement.innerHTML = '';
          }
          this.remoteVideoTrack = null;
        }
      });

      this.agoraClient.on('stream-message', (uid, data) => {
        const msg = new TextDecoder().decode(data);
        if (msg.startsWith('items:')) {
          try {
            const payload = JSON.parse(msg.split('items:')[1]);
            this.ngZone.run(() => {
              this.selectedItems.set(payload);
              Object.entries(payload).forEach(([type, url]) => {
                const img = new Image();
                img.src = url as string;
                this.itemImages[type] = img;
              });
            });
          } catch (e) {
            console.error('Failed to parse items message', e);
          }
        }
      });

      // Fallback for local testing across tabs
      window.addEventListener('storage', (e) => {
        if (e.key === 'selectedItems' && e.newValue) {
          try {
            const payload = JSON.parse(e.newValue);
            this.ngZone.run(() => {
              this.selectedItems.set(payload);
              Object.entries(payload).forEach(([type, url]) => {
                const img = new Image();
                img.src = url as string;
                this.itemImages[type] = img;
              });
            });
          } catch (e) {
            console.error('Failed to parse storage items', e);
          }
        }
      });

      await this.agoraClient.join(AGORA_APP_ID, CHANNEL_NAME, null, null);

      this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      this.localVideoTrack = await AgoraRTC.createCameraVideoTrack({
        encoderConfig: { width: 640, height: 480, frameRate: 30 }
      });

      if (this.localAudioTrack && this.localVideoTrack) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.agoraClient.publish([this.localAudioTrack, this.localVideoTrack] as any);
      }

      this.statusText.set('Connected. Waiting for other user...');
      this.statusColor.set('text-emerald-400');

      if (this.videoElement && this.localVideoTrack) {
        const mediaStream = new MediaStream([this.localVideoTrack.getMediaStreamTrack()]);
        this.videoElement.nativeElement.srcObject = mediaStream;
        this.videoElement.nativeElement.play();
        
        this.videoElement.nativeElement.onloadeddata = () => {
          this.webcamRunning.set(true);
          this.predictWebcam();
        };
      }
    } catch (error) {
      console.error('Error joining call:', error);
      this.statusText.set('Failed to join call.');
      this.statusColor.set('text-red-500');
      this.leaveCall();
    }
  }

  async leaveCall() {
    this.webcamRunning.set(false);
    this.inCall.set(false);
    this.role.set(null);
    this.measurements.set(null);
    this.selectedItems.set({});
    this.itemImages = {};

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.localAudioTrack?.close();
    this.localVideoTrack?.close();
    
    if (this.agoraClient) {
      await this.agoraClient.leave();
      this.agoraClient = null;
    }

    this.statusText.set('Ready. Select a role to join the call.');
    this.statusColor.set('text-emerald-400');
  }

  selectItem(item: {type: string, url: string}) {
    this.selectedItems.update(items => {
      const newItems = { ...items };
      if (newItems[item.type] === item.url) {
        delete newItems[item.type];
      } else {
        newItems[item.type] = item.url;
      }
      
      const payload = JSON.stringify(newItems);
      if (this.agoraClient) {
        const data = new TextEncoder().encode(`items:${payload}`);
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const clientAny = this.agoraClient as any;
          if (clientAny.createDataStream && clientAny.sendStreamMessage) {
            const streamId = clientAny.createDataStream({syncWithAudio: false, ordered: true});
            clientAny.sendStreamMessage(streamId, data);
          }
        } catch (e) {
          console.error("Failed to send stream message", e);
        }
      }
      // Fallback for local testing across tabs
      localStorage.setItem('selectedItems', payload);
      
      return newItems;
    });
  }

  private predictWebcam = () => {
    if (!this.webcamRunning() || !this.videoElement || !this.canvasElement || !this.poseLandmarker) return;

    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    const canvasCtx = canvas.getContext('2d');
    
    if (!canvasCtx) return;

    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const startTimeMs = performance.now();
    if (this.lastVideoTime !== video.currentTime) {
      this.lastVideoTime = video.currentTime;
      const poseLandmarkerResult = this.poseLandmarker.detectForVideo(video, startTimeMs);
      
      canvasCtx.save();
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw the video frame
      canvasCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const drawingUtils = new DrawingUtils(canvasCtx);

      if (poseLandmarkerResult.landmarks && poseLandmarkerResult.landmarks.length > 0) {
        const landmarks = poseLandmarkerResult.landmarks[0];
        const w = canvas.width;
        const h = canvas.height;

        const getPx = (lm: { x: number; y: number }) => ({ x: lm.x * w, y: lm.y * h });
        const calcDist = (p1: { x: number; y: number }, p2: { x: number; y: number }) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));

        const l_shoulder = getPx(landmarks[11]);
        const r_shoulder = getPx(landmarks[12]);
        const l_hip = getPx(landmarks[23]);
        const r_hip = getPx(landmarks[24]);
        const l_ankle = getPx(landmarks[27]);
        const r_ankle = getPx(landmarks[28]);
        const nose = getPx(landmarks[0]);
        const l_eye = getPx(landmarks[2]);
        const r_eye = getPx(landmarks[5]);
        const l_elbow = getPx(landmarks[13]);
        const l_wrist = getPx(landmarks[15]);
        const r_elbow = getPx(landmarks[14]);
        const r_wrist = getPx(landmarks[16]);

        // Draw body tracking lines for both buyer and seller
        for (const landmark of poseLandmarkerResult.landmarks) {
          drawingUtils.drawLandmarks(landmark, {
            radius: 2,
            color: '#f57542',
            lineWidth: 2
          });
          drawingUtils.drawConnectors(landmark, PoseLandmarker.POSE_CONNECTIONS, {
            color: '#f542e6',
            lineWidth: 2
          });
        }

        if (this.role() === 'buyer') {
          // Virtual Try-On
          Object.entries(this.selectedItems()).forEach(([type, url]) => {
            const img = this.itemImages[type];
            if (img && img.complete) {
              drawItem(canvasCtx, img, type, landmarks, canvas.width, canvas.height);
            }
          });

          // Calculate Measurements
          const current_shoulder_px = calcDist(l_shoulder, r_shoulder);
          const mid_shoulder = { x: (l_shoulder.x + r_shoulder.x)/2, y: (l_shoulder.y + r_shoulder.y)/2 };
          const mid_hip = { x: (l_hip.x + r_hip.x)/2, y: (l_hip.y + r_hip.y)/2 };
          const mid_ankle = { x: (l_ankle.x + r_ankle.x)/2, y: (l_ankle.y + r_ankle.y)/2 };
          const body_length_px = calcDist(nose, mid_ankle);
          
          const eye_dist_px = calcDist(l_eye, r_eye);
          const nose_to_l_eye = calcDist(nose, l_eye);
          const nose_to_r_eye = calcDist(nose, r_eye);
          
          const face_ratio = nose_to_l_eye / nose_to_r_eye;
          const is_facing_forward = face_ratio > 0.7 && face_ratio < 1.3;
          const KNOWN_IPD_CM = 6.3;
          
          if (is_facing_forward && eye_dist_px > 5) {
            const current_pixels_per_cm = eye_dist_px / KNOWN_IPD_CM;
            if (this.smoothedPixelsPerCm === 0) {
              this.smoothedPixelsPerCm = current_pixels_per_cm;
            } else {
              this.smoothedPixelsPerCm = (this.smoothedPixelsPerCm * 0.95) + (current_pixels_per_cm * 0.05);
            }
          }

          const pixels_per_cm = this.smoothedPixelsPerCm > 0 ? this.smoothedPixelsPerCm : (body_length_px / (170 * 0.88));
          const actual_height_cm = (body_length_px / pixels_per_cm) / 0.88;
          const shoulder_cm = current_shoulder_px / pixels_per_cm;
          const l_arm_px = calcDist(l_shoulder, l_elbow) + calcDist(l_elbow, l_wrist);
          const r_arm_px = calcDist(r_shoulder, r_elbow) + calcDist(r_elbow, r_wrist);
          const arm_length_cm = ((l_arm_px + r_arm_px) / 2) / pixels_per_cm;
          const torso_px = calcDist(mid_shoulder, mid_hip);
          const torso_cm = torso_px / pixels_per_cm;
          const legs_px = calcDist(mid_hip, mid_ankle);
          const legs_cm = (legs_px / pixels_per_cm) + (actual_height_cm * 0.04);

          // Draw measurement text on canvas
          canvasCtx.save();
          canvasCtx.font = 'bold 18px Inter, sans-serif';
          canvasCtx.fillStyle = '#34d399'; // emerald-400
          canvasCtx.strokeStyle = '#000000';
          canvasCtx.lineWidth = 4;
          canvasCtx.textAlign = 'center';

          const drawText = (text: string, x: number, y: number) => {
            canvasCtx.save();
            canvasCtx.translate(x, y);
            canvasCtx.scale(-1, 1); // Flip text so it reads correctly after CSS mirror
            canvasCtx.strokeText(text, 0, 0);
            canvasCtx.fillText(text, 0, 0);
            canvasCtx.restore();
          };

          // Shoulder width
          drawText(`${shoulder_cm.toFixed(1)} cm`, mid_shoulder.x, mid_shoulder.y - 20);
          
          // Torso (Shoulder to Waist)
          const mid_torso = { x: (mid_shoulder.x + mid_hip.x)/2, y: (mid_shoulder.y + mid_hip.y)/2 };
          drawText(`${torso_cm.toFixed(1)} cm`, mid_torso.x, mid_torso.y);

          // Legs (Waist to Ankle)
          const mid_leg = { x: (mid_hip.x + mid_ankle.x)/2, y: (mid_hip.y + mid_ankle.y)/2 };
          drawText(`${legs_cm.toFixed(1)} cm`, mid_leg.x, mid_leg.y);

          // Left Arm
          const l_arm_mid = { x: (l_shoulder.x + l_elbow.x)/2, y: (l_shoulder.y + l_elbow.y)/2 };
          drawText(`${(l_arm_px / pixels_per_cm).toFixed(1)} cm`, l_arm_mid.x, l_arm_mid.y - 15);

          // Right Arm
          const r_arm_mid = { x: (r_shoulder.x + r_elbow.x)/2, y: (r_shoulder.y + r_elbow.y)/2 };
          drawText(`${(r_arm_px / pixels_per_cm).toFixed(1)} cm`, r_arm_mid.x, r_arm_mid.y - 15);

          canvasCtx.restore();

          this.ngZone.run(() => {
            this.measurements.set({
              height: actual_height_cm,
              shoulder: shoulder_cm,
              arm: arm_length_cm,
              torso: torso_cm,
              legs: legs_cm
            });
          });
        }
      }
      canvasCtx.restore();
    }

    if (this.webcamRunning()) {
      this.animationFrameId = requestAnimationFrame(this.predictWebcam);
    }
  }
}
