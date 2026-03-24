import { ChangeDetectionStrategy, Component, signal, OnInit, PLATFORM_ID, inject, ViewChild, ElementRef, AfterViewInit, OnDestroy, NgZone } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import type { IAgoraRTCClient, ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteVideoTrack, IRemoteAudioTrack } from 'agora-rtc-sdk-ng';

const AGORA_APP_ID = 'ccd55ca11eb044efa9c85caed54542e5';
const CHANNEL_NAME = 'virtual-tryon-demo';

const drawItem = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, type: string, landmarks: any, w: number, h: number, offsetX: number, offsetY: number, scale: number) => {
  const getPx = (lm: any) => ({ x: lm.x * w, y: lm.y * h });
  
  if (type === 'shirt') {
    const l_shoulder = getPx(landmarks[11]);
    const r_shoulder = getPx(landmarks[12]);
    const l_hip = getPx(landmarks[23]);
    const r_hip = getPx(landmarks[24]);
    const l_elbow = getPx(landmarks[13]);
    const r_elbow = getPx(landmarks[14]);
    
    const shoulder_width = Math.sqrt(Math.pow(l_shoulder.x - r_shoulder.x, 2) + Math.pow(l_shoulder.y - r_shoulder.y, 2));
    const torso_height = Math.sqrt(Math.pow((l_shoulder.x + r_shoulder.x)/2 - (l_hip.x + r_hip.x)/2, 2) + Math.pow((l_shoulder.y + r_shoulder.y)/2 - (l_hip.y + r_hip.y)/2, 2));
    
    const img_w = shoulder_width * 2.2 * scale;
    const img_h = torso_height * 1.6 * scale;
    
    const center_x = (l_shoulder.x + r_shoulder.x) / 2 + offsetX;
    const center_y = (l_shoulder.y + r_shoulder.y) / 2 + (torso_height * 0.1) + offsetY;
    
    const shoulder_angle = Math.atan2(r_shoulder.y - l_shoulder.y, r_shoulder.x - l_shoulder.x);
    const hip_angle = Math.atan2(r_hip.y - l_hip.y, r_hip.x - l_hip.x);
    const angle = (shoulder_angle + hip_angle) / 2;
    
    ctx.save();
    ctx.translate(center_x, center_y);
    ctx.rotate(angle);
    
    // Add shadow for realism
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 10;
    
    ctx.drawImage(img, -img_w / 2, -img_h / 4, img_w, img_h);
    
    // Reset shadow for border and points
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = 'rgba(52, 211, 153, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(-img_w / 2, -img_h / 4, img_w, img_h);
    ctx.setLineDash([]);
    
    const corners = [
      {x: -img_w / 2, y: -img_h / 4},
      {x: img_w / 2, y: -img_h / 4},
      {x: -img_w / 2, y: img_h * 0.75},
      {x: img_w / 2, y: img_h * 0.75},
    ];
    
    for(let i=1; i<=5; i++) {
        corners.push({x: -img_w/2 + (img_w/6)*i, y: -img_h/4});
        corners.push({x: -img_w/2 + (img_w/6)*i, y: img_h * 0.75});
    }
    for(let i=1; i<=4; i++) {
        corners.push({x: -img_w/2, y: -img_h/4 + (img_h/5)*i});
        corners.push({x: img_w/2, y: -img_h/4 + (img_h/5)*i});
    }
    
    ctx.fillStyle = '#f59e0b';
    corners.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
    });
    
    ctx.restore();

    // Add extra tracking points on absolute positions
    ctx.fillStyle = '#0ea5e9'; // sky-500
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    
    const extraPoints = [
      { x: l_shoulder.x + (l_hip.x - l_shoulder.x)*0.33, y: l_shoulder.y + (l_hip.y - l_shoulder.y)*0.33 },
      { x: l_shoulder.x + (l_hip.x - l_shoulder.x)*0.66, y: l_shoulder.y + (l_hip.y - l_shoulder.y)*0.66 },
      { x: r_shoulder.x + (r_hip.x - r_shoulder.x)*0.33, y: r_shoulder.y + (r_hip.y - r_shoulder.y)*0.33 },
      { x: r_shoulder.x + (r_hip.x - r_shoulder.x)*0.66, y: r_shoulder.y + (r_hip.y - r_shoulder.y)*0.66 },
      { x: (l_shoulder.x + l_elbow.x)/2, y: (l_shoulder.y + l_elbow.y)/2 },
      { x: (r_shoulder.x + r_elbow.x)/2, y: (r_shoulder.y + r_elbow.y)/2 },
      l_elbow,
      r_elbow
    ];
    
    extraPoints.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
    });
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
    { id: 'green-shirt', type: 'shirt', url: 'https://upload.wikimedia.org/wikipedia/commons/0/07/T-shirt-green.svg', name: 'Green T-Shirt' }
  ];
  selectedItems = signal<Record<string, string>>({});
  itemImages: Record<string, HTMLImageElement> = {};

  clothOffsetX = signal(0);
  clothOffsetY = signal(0);
  clothScale = signal(1);

  positionFeedback = signal<string>('Detecting position...');
  positionStatus = signal<'good' | 'warning' | 'error'>('warning');
  
  cameraAngleFeedback = signal<string>('Detecting angle...');
  cameraAngleStatus = signal<'good' | 'warning' | 'error'>('warning');
  
  distanceFromCamera = signal<number | null>(null);

  adjustCloth(direction: 'up' | 'down' | 'left' | 'right' | 'in' | 'out') {
    const step = 10;
    const scaleStep = 0.05;
    
    switch (direction) {
      case 'up':
        this.clothOffsetY.update(v => v - step);
        break;
      case 'down':
        this.clothOffsetY.update(v => v + step);
        break;
      case 'left':
        this.clothOffsetX.update(v => v - step);
        break;
      case 'right':
        this.clothOffsetX.update(v => v + step);
        break;
      case 'in':
        this.clothScale.update(v => Math.max(0.5, v - scaleStep));
        break;
      case 'out':
        this.clothScale.update(v => Math.min(2.0, v + scaleStep));
        break;
    }
  }

  private beforeUnloadListener = () => {
    if (this.agoraClient) {
      this.agoraClient.leave();
    }
  };

  async ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      // Preload images
      this.availableItems.forEach(item => {
        const img = new Image();
        img.src = item.url;
      });
      window.addEventListener('beforeunload', this.beforeUnloadListener);
    }
  }

  async ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) {
      await this.initializeMediaPipe();
    }
  }

  ngOnDestroy() {
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('beforeunload', this.beforeUnloadListener);
    }
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
      if (this.inCall()) {
        this.statusText.set('Model loaded. Tracking active.');
        this.statusColor.set('text-emerald-400');
      } else {
        this.statusText.set('Ready. Select a role to join the call.');
        this.statusColor.set('text-emerald-400');
      }
    } catch (error) {
      console.error(error);
      this.statusText.set('Error loading model.');
      this.statusColor.set('text-red-500');
    }
  }

  private storageListener = (e: StorageEvent) => {
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
  };

  async joinCall(selectedRole: 'seller' | 'buyer') {
    if (this.agoraClient) {
      await this.leaveCall();
    }

    this.role.set(selectedRole);
    this.inCall.set(true);
    this.statusText.set('Connecting to call...');
    this.statusColor.set('text-yellow-400');

    if (!this.poseLandmarker) {
      this.statusText.set('Loading AI model...');
      this.statusColor.set('text-blue-400');
    }

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
      window.addEventListener('storage', this.storageListener);

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

    window.removeEventListener('storage', this.storageListener);

    try {
      if (this.agoraClient) {
        if (this.localAudioTrack || this.localVideoTrack) {
          const tracksToUnpublish = [];
          if (this.localAudioTrack) tracksToUnpublish.push(this.localAudioTrack);
          if (this.localVideoTrack) tracksToUnpublish.push(this.localVideoTrack);
          
          if (tracksToUnpublish.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await this.agoraClient.unpublish(tracksToUnpublish as any);
          }
        }
        
        await this.agoraClient.leave();
        this.agoraClient.removeAllListeners();
        this.agoraClient = null;
      }
    } catch (e) {
      console.error('Error leaving Agora channel', e);
    } finally {
      this.localAudioTrack?.close();
      this.localVideoTrack?.close();
      this.localAudioTrack = null;
      this.localVideoTrack = null;
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
    if (!this.webcamRunning() || !this.videoElement || !this.canvasElement) {
      if (this.webcamRunning()) {
        this.animationFrameId = requestAnimationFrame(this.predictWebcam);
      }
      return;
    }

    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    const canvasCtx = canvas.getContext('2d');
    
    if (!canvasCtx) {
      this.animationFrameId = requestAnimationFrame(this.predictWebcam);
      return;
    }

    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    if (!this.poseLandmarker) {
      // Just draw the video frame if model is not ready
      canvasCtx.save();
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
      canvasCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvasCtx.restore();
      this.animationFrameId = requestAnimationFrame(this.predictWebcam);
      return;
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
              drawItem(canvasCtx, img, type, landmarks, canvas.width, canvas.height, this.clothOffsetX(), this.clothOffsetY(), this.clothScale());
            }
          });

          // Calculate Measurements
          const current_shoulder_px = calcDist(l_shoulder, r_shoulder);
          const mid_shoulder = { x: (l_shoulder.x + r_shoulder.x)/2, y: (l_shoulder.y + r_shoulder.y)/2 };
          const mid_hip = { x: (l_hip.x + r_hip.x)/2, y: (l_hip.y + r_hip.y)/2 };
          const mid_ankle = { x: (l_ankle.x + r_ankle.x)/2, y: (l_ankle.y + r_ankle.y)/2 };
          const body_length_px = calcDist(nose, mid_ankle);
          
          // Position Feedback Logic
          const isVisible = (lm: any) => lm && lm.visibility > 0.5;
          let newFeedback = '';
          let newStatus: 'good' | 'warning' | 'error' = 'good';
          
          if (!isVisible(landmarks[11]) || !isVisible(landmarks[12]) || !isVisible(landmarks[23]) || !isVisible(landmarks[24])) {
            newFeedback = 'Step back to show your full torso';
            newStatus = 'error';
          } else {
            const torso_px = calcDist(mid_shoulder, mid_hip);
            const ratio = torso_px / canvas.height;
            const mid_torso_x = (mid_shoulder.x + mid_hip.x) / 2;
            
            // Canvas is mirrored horizontally (scale-x-[-1]), so if mid_torso_x is small (left side of canvas),
            // it means the user is physically on the right side of the camera's view, so they should move left.
            if (mid_torso_x < canvas.width * 0.35) {
              newFeedback = 'Shift Left';
              newStatus = 'warning';
            } else if (mid_torso_x > canvas.width * 0.65) {
              newFeedback = 'Shift Right';
              newStatus = 'warning';
            } else if (ratio < 0.25) {
              newFeedback = 'Move Closer';
              newStatus = 'warning';
            } else if (ratio > 0.60) {
              newFeedback = 'Move Back';
              newStatus = 'warning';
            } else {
              newFeedback = 'Perfect Position - STOP';
              newStatus = 'good';
            }
          }
          
          if (this.positionFeedback() !== newFeedback) {
            this.ngZone.run(() => {
              this.positionFeedback.set(newFeedback);
              this.positionStatus.set(newStatus);
            });
          }
          
          const eye_dist_px = calcDist(l_eye, r_eye);
          const nose_to_l_eye = calcDist(nose, l_eye);
          const nose_to_r_eye = calcDist(nose, r_eye);
          
          const face_ratio = nose_to_l_eye / nose_to_r_eye;
          const is_facing_forward = face_ratio > 0.7 && face_ratio < 1.3;
          const KNOWN_IPD_CM = 6.3;
          
          // Distance Estimation
          // Approximate focal length for a standard webcam (e.g., 60-70 deg FOV)
          const focal_length_px = canvas.width * 0.8; 
          let distance_cm = null;
          
          if (is_facing_forward && eye_dist_px > 5) {
            distance_cm = (KNOWN_IPD_CM * focal_length_px) / eye_dist_px;
            
            const current_pixels_per_cm = eye_dist_px / KNOWN_IPD_CM;
            if (this.smoothedPixelsPerCm === 0) {
              this.smoothedPixelsPerCm = current_pixels_per_cm;
            } else {
              this.smoothedPixelsPerCm = (this.smoothedPixelsPerCm * 0.95) + (current_pixels_per_cm * 0.05);
            }
          }
          
          // Camera Angle Estimation
          let newAngleFeedback = 'Detecting angle...';
          let newAngleStatus: 'good' | 'warning' | 'error' = 'warning';
          
          if (isVisible(landmarks[11]) && isVisible(landmarks[12]) && isVisible(landmarks[23]) && isVisible(landmarks[24])) {
            const shoulder_width_px = calcDist(l_shoulder, r_shoulder);
            const hip_width_px = calcDist(l_hip, r_hip);
            
            if (hip_width_px > 0) {
              const angle_ratio = shoulder_width_px / hip_width_px;
              
              if (angle_ratio > 1.6) {
                newAngleFeedback = 'Camera too high. Tilt down ⬇️';
                newAngleStatus = 'error';
              } else if (angle_ratio < 1.1) {
                newAngleFeedback = 'Camera too low. Tilt up ⬆️';
                newAngleStatus = 'error';
              } else {
                newAngleFeedback = 'Camera angle is good ✅';
                newAngleStatus = 'good';
              }
            }
          }

          this.ngZone.run(() => {
            if (distance_cm) {
              this.distanceFromCamera.set(distance_cm);
            }
            if (this.cameraAngleFeedback() !== newAngleFeedback) {
              this.cameraAngleFeedback.set(newAngleFeedback);
              this.cameraAngleStatus.set(newAngleStatus);
            }
          });

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
