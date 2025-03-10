import sys
from PySide6.QtWidgets import QApplication, QWidget, QPushButton, QFileDialog, QVBoxLayout, QLabel, QSlider
from PySide6.QtMultimedia import QMediaPlayer, QAudioOutput
from PySide6.QtMultimediaWidgets import QVideoWidget
from PySide6.QtCore import Qt, QUrl

class VideoEditor(QWidget):
    def __init__(self):
        super().__init__()

        # Setup Window
        self.setWindowTitle("Safecut - Video Editor")
        self.setGeometry(100, 100, 900, 600)

        # Video Player
        self.media_player = QMediaPlayer()
        self.audio_output = QAudioOutput()
        self.media_player.setAudioOutput(self.audio_output)

        # Video Display Widget
        self.video_widget = QVideoWidget()
        self.media_player.setVideoOutput(self.video_widget)

        # Buttons
        self.open_button = QPushButton("Open Video")
        self.open_button.clicked.connect(self.open_file)

        self.play_button = QPushButton("Play")
        self.play_button.clicked.connect(self.play_video)

        # Progress Slider
        self.slider = QSlider(Qt.Horizontal)
        self.slider.setRange(0, 100)
        self.slider.sliderMoved.connect(self.set_position)

        # Layout
        layout = QVBoxLayout()
        layout.addWidget(self.video_widget)
        layout.addWidget(self.slider)
        layout.addWidget(self.open_button)
        layout.addWidget(self.play_button)

        self.setLayout(layout)

        # Connect Signals
        self.media_player.durationChanged.connect(self.update_duration)
        self.media_player.positionChanged.connect(self.update_position)

    def open_file(self):
        file_path, _ = QFileDialog.getOpenFileName(self, "Open Video", "", "Videos (*.mp4 *.avi *.mkv)")
        if file_path:
            self.media_player.setSource(QUrl.fromLocalFile(file_path))

    def play_video(self):
        if self.media_player.playbackState() == QMediaPlayer.PlayingState:
            self.media_player.pause()
        else:
            self.media_player.play()

    def update_duration(self, duration):
        self.slider.setRange(0, duration)

    def update_position(self, position):
        self.slider.setValue(position)

    def set_position(self, position):
        self.media_player.setPosition(position)

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = VideoEditor()
    window.show()
    sys.exit(app.exec())
