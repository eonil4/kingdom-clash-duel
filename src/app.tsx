import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { Provider } from "react-redux";
import { MainLayout } from "@/layouts/MainLayout";
import { AppRouter } from "@/router";
import { store } from "@/store";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#c9a227" },
    secondary: { main: "#4a7dbd" },
    background: { default: "#0f1218", paper: "#171b24" },
  },
  typography: {
    fontFamily: '"DM Sans", "Helvetica Neue", Helvetica, sans-serif',
    h4: { fontWeight: 700 },
    subtitle1: { fontWeight: 600 },
    body1: { fontFamily: '"Source Serif 4", "Georgia", serif' },
    body2: { fontFamily: '"Source Serif 4", "Georgia", serif' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundImage: "radial-gradient(ellipse at top, #1a2230 0%, #0f1218 55%)",
          minHeight: "100vh",
        },
      },
    },
  },
});

export function App() {
  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <MainLayout>
          <AppRouter />
        </MainLayout>
      </ThemeProvider>
    </Provider>
  );
}
