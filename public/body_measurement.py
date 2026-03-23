import cv2
import mediapipe as mp
import numpy as np
import math
import platform
import os
import time

# ==============================================================================
# CONFIGURATION & CALIBRATION
# ==============================================================================
# To measure accurately with a single webcam, we use a "Reference Distance" method.
# We assume the user's shoulder width is roughly a known average (e.g., 40 cm).
# We instruct the user to move until their shoulder width in the camera feed 
# matches a specific pixel width (TARGET_SHOULDER_PX). 
# Once they match this pixel width, we know they are at the "proper distance".
# At this distance, we lock in the pixel-to-cm ratio and take the measurements.

KNOWN_SHOULDER_WIDTH_CM = 40.0
TARGET_SHOULDER_PX = 180      # Pixel width of shoulders at the proper distance
DISTANCE_THRESHOLD_PX = 15    # Tolerance for being at the proper distance (+/- pixels)

# Initialize MediaPipe Pose
mp_pose = mp.solutions.pose
mp_drawing = mp.solutions.drawing_utils
pose = mp_pose.Pose(
    min_detection_confidence=0.7, 
    min_tracking_confidence=0.7,
    model_complexity=1 # 0=Lite, 1=Full, 2=Heavy. 1 provides a good balance of accuracy and speed.
)

def play_beep():
    """Plays a beep sound cross-platform to notify the user."""
    print("\n>>> BEEP! Proper distance reached. Capturing measurements... <<<")
    if platform.system() == "Windows":
        import winsound
        winsound.Beep(1000, 500) # Frequency 1000Hz, Duration 500ms
    else:
        # Linux/Mac fallback
        print('\a', end='', flush=True) # Terminal bell
        try:
            # Try using sox (play) or afplay (mac) if available
            if platform.system() == "Darwin":
                os.system('afplay /System/Library/Sounds/Glass.aiff &')
            else:
                os.system('play -nq -t alsa synth 0.5 sine 1000 > /dev/null 2>&1 &')
        except:
            pass

def calculate_distance(p1, p2):
    """Calculates Euclidean distance between two points [x, y]."""
    return math.sqrt((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2)

def get_landmark_px(landmark, frame_width, frame_height):
    """Converts normalized landmark coordinates (0.0 to 1.0) to pixel coordinates."""
    return [int(landmark.x * frame_width), int(landmark.y * frame_height)]

def main():
    cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        print("Error: Could not open webcam.")
        return

    print("="*60)
    print(" BODY DIMENSION MEASUREMENT SYSTEM ")
    print("="*60)
    print("Instructions:")
    print("1. Stand in front of the camera so your full body is visible.")
    print("2. Move closer or further away to align with the target distance.")
    print("3. The system will beep and auto-capture when you are in position.")
    print("Press 'ESC' to quit at any time.")
    print("="*60)
    
    pixels_per_cm = None
    proper_distance_reached = False
    final_measurements = {}
    
    # Give the camera a moment to warm up
    time.sleep(2)

    while cap.isOpened():
        success, image = cap.read()
        if not success:
            print("Ignoring empty camera frame.")
            continue

        # Flip the image horizontally for a later selfie-view display
        image = cv2.flip(image, 1)
        
        # Convert the BGR image to RGB
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        
        # To improve performance, mark the image as not writeable to pass by reference
        image_rgb.flags.writeable = False
        results = pose.process(image_rgb)

        # Draw the pose annotation on the image
        image_rgb.flags.writeable = True
        h, w, _ = image.shape

        if results.pose_landmarks:
            # Draw landmarks
            mp_drawing.draw_landmarks(
                image,
                results.pose_landmarks,
                mp_pose.POSE_CONNECTIONS,
                landmark_drawing_spec=mp_drawing.DrawingSpec(color=(245,117,66), thickness=2, circle_radius=2),
                connection_drawing_spec=mp_drawing.DrawingSpec(color=(245,66,230), thickness=2, circle_radius=2)
            )

            landmarks = results.pose_landmarks.landmark

            # Extract key landmarks
            l_shoulder = get_landmark_px(landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value], w, h)
            r_shoulder = get_landmark_px(landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER.value], w, h)
            l_ankle = get_landmark_px(landmarks[mp_pose.PoseLandmark.LEFT_ANKLE.value], w, h)
            r_ankle = get_landmark_px(landmarks[mp_pose.PoseLandmark.RIGHT_ANKLE.value], w, h)
            nose = get_landmark_px(landmarks[mp_pose.PoseLandmark.NOSE.value], w, h)
            l_elbow = get_landmark_px(landmarks[mp_pose.PoseLandmark.LEFT_ELBOW.value], w, h)
            l_wrist = get_landmark_px(landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value], w, h)

            # 1. Calculate current shoulder width in pixels to determine distance
            current_shoulder_px = calculate_distance(l_shoulder, r_shoulder)

            if not proper_distance_reached:
                # Provide visual feedback for positioning
                diff = current_shoulder_px - TARGET_SHOULDER_PX
                
                if diff > DISTANCE_THRESHOLD_PX:
                    status_text = "Move Further Back"
                    color = (0, 0, 255) # Red
                elif diff < -DISTANCE_THRESHOLD_PX:
                    status_text = "Move Closer"
                    color = (0, 0, 255) # Red
                else:
                    status_text = "HOLD STILL..."
                    color = (0, 255, 255) # Yellow

                # Display positioning UI
                cv2.putText(image, f"Status: {status_text}", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
                
                # Draw a target box to help the user align their shoulders
                center_x, center_y = int(w/2), int(h/3)
                box_half_width = int(TARGET_SHOULDER_PX / 2)
                cv2.rectangle(image, 
                              (center_x - box_half_width, center_y - 20), 
                              (center_x + box_half_width, center_y + 20), 
                              (255, 255, 255), 2)
                cv2.putText(image, "Align shoulders here", (center_x - 80, center_y - 30), 
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

                # Check if within threshold
                if abs(diff) <= DISTANCE_THRESHOLD_PX:
                    proper_distance_reached = True
                    
                    # --- CALIBRATION ---
                    # Calculate the pixel-to-cm ratio based on the known reference
                    pixels_per_cm = current_shoulder_px / KNOWN_SHOULDER_WIDTH_CM
                    
                    # --- MEASUREMENTS ---
                    # 1. Shoulder Width (Should be very close to KNOWN_SHOULDER_WIDTH_CM)
                    shoulder_cm = current_shoulder_px / pixels_per_cm
                    
                    # 2. Height
                    # Calculate distance from nose to the midpoint of the ankles
                    mid_ankle = [(l_ankle[0] + r_ankle[0])/2, (l_ankle[1] + r_ankle[1])/2]
                    body_length_px = calculate_distance(nose, mid_ankle)
                    # Add an estimated 12cm for the top of the head (above the nose)
                    height_cm = (body_length_px / pixels_per_cm) + 12.0 
                    
                    # 3. Arm Length (Left Arm: Shoulder -> Elbow -> Wrist)
                    upper_arm_px = calculate_distance(l_shoulder, l_elbow)
                    lower_arm_px = calculate_distance(l_elbow, l_wrist)
                    arm_length_cm = (upper_arm_px + lower_arm_px) / pixels_per_cm

                    final_measurements = {
                        "Height": height_cm,
                        "Shoulder Width": shoulder_cm,
                        "Arm Length": arm_length_cm
                    }

                    # Trigger alerts and UI updates
                    play_beep()
                    cv2.putText(image, "SUCCESS! CAPTURING...", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 3)
                    cv2.imshow('Body Dimension Measurement', image)
                    cv2.waitKey(1500) # Freeze frame for 1.5 seconds to show success
                    break # Exit the loop

        cv2.imshow('Body Dimension Measurement', image)
        
        # Press 'ESC' to exit
        if cv2.waitKey(5) & 0xFF == 27:
            break

    # Cleanup
    cap.release()
    cv2.destroyAllWindows()

    # Output Results
    if proper_distance_reached:
        print("\n" + "="*40)
        print(" FINAL MEASUREMENT RESULTS ")
        print("="*40)
        for key, value in final_measurements.items():
            print(f"{key}: {value:.1f} cm")
        print("="*40)
    else:
        print("\nMeasurement cancelled. Proper distance was not reached.")

if __name__ == "__main__":
    main()
