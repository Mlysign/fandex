// The app's entry. The background task is registered first: Android can start
// this JavaScript with no screen (the widget's tick), and the task has to exist
// by the time the native side asks for it.
import './src/headless';
import 'expo-router/entry';
