import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { installNonBlockingAlerts } from './utils/safeAlert';
import './index.css';

// Native JavaScript alert dialogs can leave Electron's renderer without a
// usable text-entry focus on Windows. Use an in-app notice that never steals focus.
installNonBlockingAlerts();

createRoot(document.getElementById('root')!).render(<App />);
