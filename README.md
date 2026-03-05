# Decentralized 5-City Microgrid Network

A prototype system simulating a decentralized energy management system (EMS) for a 5-city microgrid network in India. This project incorporates historical weather data, artificial intelligence optimization (IAROA algorithm), and Model Predictive Control (MPC) dispatching to provide efficient, peer-to-peer energy trading while reducing costs and carbon emissions.

## Features

- **Decentralized Optimization**: Uses Improved Artificial Rabbits Optimization Algorithm (IAROA) at the local city scale to minimize operational costs and carbon emissions.
- **MPC Dispatching**: Real-time correction using single step heuristic dispatch applied on top of the established IAROA plan, cutting grid imports at high emission peak hours and efficiently maximizing returns.
- **Peer-to-Peer Energy Trading**: Facilitates automatic, prioritized energy exchange from surplus to deficit cities over a dynamic mesh network.
- **Full View Dashboard**: A visually engaging React frontend built with Vite displaying the live topological network, per-city metrics, dynamic load forecasts, and historical 24-hr simulations natively in the browser.

## Technologies Used

- **Backend**: Python, FastAPI, NumPy, openmeteo-requests, requests-cache
- **Frontend**: JavaScript, React, Vite, Recharts, Lucide-react

## Setup & Run

### Backend API Setup

1. Create a virtual environment and install the required Python packages:

   ```shell
   pip install -r requirements.txt
   ```

2. Run the FastAPI development server:

   ```shell
   uvicorn decentralized_api:app --reload --port 8001
   ```

### Frontend Web Setup

1. Change the directory to the frontend codebase:

   ```shell
   cd ems-web
   ```

2. Install dependencies via npm:

   ```shell
   npm install
   ```

3. Run the development server:

   ```shell
   npm run dev
   ```

### Quick Start

Instead of starting both APIs manually, you can use the provided batch script on Windows:

```cmd
.\start_servers.bat
```

## License

This project is licensed under the MIT License - see the `LICENSE` file for details.
