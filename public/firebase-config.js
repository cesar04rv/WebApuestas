// Firebase Configuration
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAkP1v31LPhFxJQnaD74fg3G6y3juQnppQ",
  authDomain: "loginwebapuestas.firebaseapp.com",
  projectId: "loginwebapuestas",
  storageBucket: "loginwebapuestas.firebasestorage.app",
  messagingSenderId: "210478444611",
  appId: "1:210478444611:web:b10cea26d4bbafed8224f6",
  measurementId: "G-W6756DJ6M6"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export { 
  auth, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
};