import "dotenv/config";
import express, {type Application, type Request, type Response} from 'express'
import cors from 'cors'
import helmet from 'helmet'
import bodyParser from 'body-parser'
import morgan from 'morgan'
import cookieParser from 'cookie-parser'
import { toNodeHandler } from 'better-auth/node'
import { auth } from './lib/auth'
import { billing } from './src/routes/route'
import { cartItem, category, order, product } from './src/routes/route'
import { createServer } from 'http'
import { initialWebsocket, closeWebsocket } from "./src/utility/websock"


const app:Application = express();
const server = createServer(app)
const PORT = Number(process.env.PORT) || 8000

initialWebsocket(server)
//middleware
app.use(cors({
    origin:process.env.CLIENT_ROUTE as string,
    methods:["POST","GET", "PUT","DELETE"],
    credentials:true
}))

app.use(
    helmet({
        crossOriginOpenerPolicy: {policy: "same-origin"}
    })
)

app.all("/api/auth/*splat", toNodeHandler(auth));
//parser

app.use(bodyParser.json({ limit: '6mb' }))
app.use(cookieParser())

if(process.env.NODE_ENV === 'development'){
    app.use(morgan("dev"))

}
app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
});

//app route
app.use("/api/category", category)
app.use("/api/product", product)
app.use("/api/cartItem", cartItem)
app.use("/api/order", order)
app.use("/api/billing", billing)

//global error
app.use((err:Error, req: Request, res:Response)=>{
    console.error(err.stack)
    if (res.headersSent) return;
    res.status(500).json({message:"Server: Something Wrong"})
})

server.listen(PORT, ()=>{
    console.log(`Server is Running on Port: ${PORT}`)

})