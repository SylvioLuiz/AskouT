// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.3"),
        .package(name: "CapacitorFilesystem", path: "../../../../../node_modules/@capacitor/filesystem"),
        .package(name: "CapacitorSplashScreen", path: "../../../../../node_modules/@capacitor/splash-screen"),
        .package(name: "CapacitorStatusBar", path: "../../../../../node_modules/@capacitor/status-bar"),
        .package(name: "CapgoNativePurchases", path: "../../../../../node_modules/@capgo/native-purchases"),
        .package(name: "CapacitorNativeVideoCompressor", path: "../../../../../node_modules/capacitor-native-video-compressor")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapacitorSplashScreen", package: "CapacitorSplashScreen"),
                .product(name: "CapacitorStatusBar", package: "CapacitorStatusBar"),
                .product(name: "CapgoNativePurchases", package: "CapgoNativePurchases"),
                .product(name: "CapacitorNativeVideoCompressor", package: "CapacitorNativeVideoCompressor")
            ]
        )
    ]
)
