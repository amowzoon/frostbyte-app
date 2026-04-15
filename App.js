import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import HomeScreen from './screens/HomeScreen';
import SettingsScreen from './screens/SettingsScreen';
import AlertsScreen from './screens/AlertsScreen';
import { registerBackgroundAlertTask } from './lib/backgroundAlertTask';

const Stack = createStackNavigator();

const AppNavigator = React.memo(function AppNavigator() {
  const { isLoggedIn, isGuest } = useAuth();

  useEffect(() => {
    if (isLoggedIn || isGuest) {
      registerBackgroundAlertTask().then(success => {
        if (success) {
          console.log('Background alert task registered');
        }
      });
    }
  }, [isLoggedIn, isGuest]);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isLoggedIn || isGuest ? (
          <>
            <Stack.Screen name="Home"     component={HomeScreen}     />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="Alerts"   component={AlertsScreen}   />
          </>
        ) : (
          <>
            <Stack.Screen name="Login"    component={LoginScreen}    />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
});

export default function App() {
  return (
    <AuthProvider>
      <AppNavigator />
    </AuthProvider>
  );
}
