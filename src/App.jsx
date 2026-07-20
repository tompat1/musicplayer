import AudioPlayer from './components/AudioPlayer.jsx';
import tracks from './audioData.json';

function App() {
  return <AudioPlayer tracks={tracks} />;
}

export default App;
