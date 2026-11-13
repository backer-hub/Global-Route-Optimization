cmake_minimum_required(VERSION 3.16)
project(GlobalSupplyChainRouteOptimizer VERSION 1.2.0 LANGUAGES CXX)

include(CheckLanguage)
check_language(CUDA)
if(CMAKE_CUDA_COMPILER)
    enable_language(CUDA)
    set(CMAKE_CUDA_STANDARD 17)
    set(CMAKE_CUDA_STANDARD_REQUIRED ON)
    add_compile_definitions(USE_CUDA)
    message(STATUS "CUDA Compiler found: ${CMAKE_CUDA_COMPILER}")
else()
    message(STATUS "CUDA Compiler not found. Compiling fitness_kernel.cu with C++ Host Compiler.")
    if(MSVC)
        set_source_files_properties(src/fitness_kernel.cu PROPERTIES LANGUAGE CXX COMPILE_FLAGS "/TP")
    else()
        set_source_files_properties(src/fitness_kernel.cu PROPERTIES LANGUAGE CXX COMPILE_FLAGS "-x c++")
    endif()
endif()

# ==============================================================================
# C++ Standard & Compiler Configuration
# ==============================================================================
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# General compiler flags for optimization and diagnostics
if(MSVC)
    add_compile_options("$<$<COMPILE_LANGUAGE:CXX>:/W4;/O2;/EHsc;/utf-8>")
else()
    add_compile_options("$<$<COMPILE_LANGUAGE:CXX>:-Wall;-Wextra;-Wpedantic;-O3>")
endif()

# ==============================================================================
# OpenMP Intra-Node Thread Parallelization (Requirements 4 & 5)
# ==============================================================================
find_package(OpenMP REQUIRED)
if(OpenMP_CXX_FOUND)
    message(STATUS "OpenMP CXX found: ${OpenMP_CXX_VERSION}")
    add_compile_definitions(USE_OPENMP)
endif()

# ==============================================================================
# Target: route_optimizer (OpenMP Multi-Core Parallel GA + CUDA Fitness Kernel)
# ==============================================================================
add_executable(route_optimizer
    src/main.cpp
    src/graph.cpp
    src/astar.cpp
    src/ga.cpp
    src/mpi_partition.cpp
    src/fitness_kernel.cu
)

target_include_directories(route_optimizer PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

if(OpenMP_CXX_FOUND)
    target_link_libraries(route_optimizer PRIVATE OpenMP::OpenMP_CXX)
endif()

# ==============================================================================
# MPI Distributed Target (Requirement 5)
# ==============================================================================
option(ENABLE_MPI "Build with native MPI cluster linking" OFF)
if(ENABLE_MPI)
    find_package(MPI REQUIRED)
    target_link_libraries(route_optimizer PRIVATE MPI::MPI_CXX)
    target_compile_definitions(route_optimizer PRIVATE USE_MPI)
    message(STATUS "Native MPI cluster linking ENABLED")
endif()

# Output build info
message(STATUS "Configuring Global Supply Chain Route Optimizer")
message(STATUS "C++ Standard: ${CMAKE_CXX_STANDARD}")
message(STATUS "Compiler: ${CMAKE_CXX_COMPILER_ID} ${CMAKE_CXX_COMPILER_VERSION}")
